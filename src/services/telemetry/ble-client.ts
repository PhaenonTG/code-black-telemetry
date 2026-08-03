import { BleClient, dataViewToText, textToDataView, type BleDevice } from "@capacitor-community/bluetooth-le";
import { getBleCommandToken } from "../settings";

// Protocol contract lives on the Pi at ~/CodeBlack/docs/BLE_PROTOCOL.md (codeblack_ble/payloads.py
// is the source of truth). Compact JSON over a notify characteristic, fragmented into
// telemetry_fragment frames keyed by seq/i/n when the payload exceeds CB_BLE_MAX_PAYLOAD_BYTES.
const SERVICE_UUID = "8f2a0000-6d6f-4f9f-9d8b-0c0d2b4c0001";
const TELEMETRY_CHARACTERISTIC_UUID = "8f2a0003-6d6f-4f9f-9d8b-0c0d2b4c0001";
const COMMANDS_CHARACTERISTIC_UUID = "8f2a0006-6d6f-4f9f-9d8b-0c0d2b4c0001";
const COMMAND_RESPONSES_CHARACTERISTIC_UUID = "8f2a0007-6d6f-4f9f-9d8b-0c0d2b4c0001";
const COMMAND_TIMEOUT_MS = 5_000;
const SCAN_TIMEOUT_MS = 10_000;
// Active BLE scanning is one of the most power-hungry radio operations on Android -- a flat 5s
// gap between 10s scans means ~67% duty cycle forever whenever the Pi is out of range or off.
// Back off exponentially instead so a long stretch without the Pi (parked at home, Pi powered
// down) settles into brief, infrequent scans rather than nonstop scanning that outpaces charging.
const RECONNECT_DELAY_MIN_MS = 5_000;
const RECONNECT_DELAY_MAX_MS = 90_000;

export type BleHealth = "READY" | "DEGRADED" | "BACKEND_OFFLINE" | "DATA_STALE" | "NO_SENSORS";

export interface BleTelemetryPayload {
  pt: "telemetry";
  v: string;
  sid: string;
  seq: number;
  ts: string;
  age: number | null;
  health: BleHealth;
  gps: { st: string; fix: string | null; lat: number | null; lon: number | null; spd: number | null; hdg: number | null };
  wx: { st: string; t_c: number | null; rh: number | null; dp_c: number | null };
  wind: { st: string; spd: number | null; gust: number | null; dir: number | null };
  nodes: { nav: string; wx: string; wind: string };
  net: string;
  backend: string;
}

export interface BleCommandResponse {
  status: "OK" | "NOT_IMPLEMENTED" | "REJECTED";
  reason?: string;
  req_id?: string;
  last_command?: string | null;
  ts?: string;
  [key: string]: unknown;
}

type Listener = (payload: BleTelemetryPayload | null, connected: boolean) => void;

// A single long-lived scan/connect/subscribe state machine, not a per-component hook -- there's
// exactly one physical BLE radio link to the Pi, and every consumer (telemetry provider today,
// an Operations-page diagnostics panel later) should share it rather than each opening their own
// connection. Mirrors the module-singleton pattern already used for breadcrumbTrail.ts/settings.ts.
class BleTelemetryClient {
  private listeners = new Set<Listener>();
  private deviceId: string | null = null;
  private connected = false;
  private started = false;
  private stopped = true;
  private paused = false;
  private initialized = false;
  private fragmentBuffers = new Map<number, Map<number, string>>();
  private retryDelayMs = RECONNECT_DELAY_MIN_MS;
  private retryTimer: number | null = null;

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    void this.run();
  }

  stop() {
    this.stopped = true;
    this.started = false;
    this.clearRetryTimer();
    if (this.deviceId) void BleClient.disconnect(this.deviceId).catch(() => {});
    this.deviceId = null;
    this.connected = false;
  }

  // Mirrors HybridTelemetryProvider.setPaused() for the HTTP path -- called from the same
  // Capacitor appStateChange listener in App.tsx. Scanning for a device that may not even be in
  // range is exactly the kind of background radio work that shouldn't run while the app is
  // backgrounded/screen off; disconnecting also releases the radio outright rather than just
  // idling a live connection. resume() picks up immediately, same as the HTTP path's instant poll.
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.clearRetryTimer();
    BleClient.stopLEScan().catch(() => {});
    if (this.deviceId) void BleClient.disconnect(this.deviceId).catch(() => {});
    this.deviceId = null;
    this.connected = false;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.retryDelayMs = RECONNECT_DELAY_MIN_MS;
    if (this.started && !this.stopped) void this.run();
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Writes to the commands characteristic and waits for the matching req_id on command_responses.
  // The token comes from Settings automatically (never passed by callers) so every call site can't
  // forget it or accidentally log it. Throws on disconnect, timeout, or a write failure -- callers
  // (Settings lighting controls today) are expected to catch and surface REJECTED/timeout distinctly
  // from a successful OK/NOT_IMPLEMENTED response.
  async sendCommand(cmd: string, extra: Record<string, unknown> = {}): Promise<BleCommandResponse> {
    const deviceId = this.deviceId;
    if (!this.connected || !deviceId) throw new Error("BLE not connected");
    const reqId = Math.random().toString(36).slice(2, 10);
    const body = JSON.stringify({ cmd, req_id: reqId, token: getBleCommandToken(), ...extra });

    return new Promise<BleCommandResponse>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        BleClient.stopNotifications(deviceId, SERVICE_UUID, COMMAND_RESPONSES_CHARACTERISTIC_UUID).catch(() => {});
      };
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Command timed out"));
      }, COMMAND_TIMEOUT_MS);

      BleClient.startNotifications(deviceId, SERVICE_UUID, COMMAND_RESPONSES_CHARACTERISTIC_UUID, (value) => {
        if (settled) return;
        let parsed: BleCommandResponse;
        try {
          parsed = JSON.parse(dataViewToText(value)) as BleCommandResponse;
        } catch {
          return;
        }
        // command_responses also re-emits the last response on every ~2s heartbeat tick -- only
        // resolve for the notification that actually matches this call's req_id.
        if (parsed.req_id !== reqId) return;
        settled = true;
        cleanup();
        resolve(parsed);
      })
        .then(() => BleClient.write(deviceId, SERVICE_UUID, COMMANDS_CHARACTERISTIC_UUID, textToDataView(body)))
        .catch((error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  private clearRetryTimer() {
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(fn: () => void) {
    this.clearRetryTimer();
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      fn();
    }, this.retryDelayMs);
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, RECONNECT_DELAY_MAX_MS);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(payload: BleTelemetryPayload | null) {
    this.listeners.forEach((listener) => listener(payload, this.connected));
  }

  private async run() {
    if (this.stopped || this.paused) return;
    if (!this.initialized) {
      try {
        await BleClient.initialize({ androidNeverForLocation: true });
        this.initialized = true;
      } catch {
        // No BLE radio, permission denied, or unsupported platform -- retry with the same backoff
        // as a failed scan rather than giving up permanently (permission can be granted later).
        if (!this.stopped && !this.paused) this.scheduleRetry(() => void this.run());
        return;
      }
    }
    void this.scanAndConnect();
  }

  private scanForDevice(): Promise<BleDevice | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (device: BleDevice | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        BleClient.stopLEScan().catch(() => {});
        resolve(device);
      };
      const timer = window.setTimeout(() => finish(null), SCAN_TIMEOUT_MS);
      BleClient.requestLEScan({ services: [SERVICE_UUID] }, (result) => finish(result.device)).catch(() => finish(null));
    });
  }

  private async scanAndConnect() {
    if (this.stopped || this.paused) return;
    try {
      const device = await this.scanForDevice();
      if (!device) {
        if (!this.stopped && !this.paused) this.scheduleRetry(() => void this.scanAndConnect());
        return;
      }
      await BleClient.connect(device.deviceId, () => this.handleDisconnect());
      this.deviceId = device.deviceId;
      this.connected = true;
      this.retryDelayMs = RECONNECT_DELAY_MIN_MS;
      this.notify(null);
      await BleClient.startNotifications(device.deviceId, SERVICE_UUID, TELEMETRY_CHARACTERISTIC_UUID, (value) => this.handleFrame(value));
    } catch {
      if (!this.stopped && !this.paused) this.scheduleRetry(() => void this.scanAndConnect());
    }
  }

  private handleDisconnect() {
    this.connected = false;
    this.deviceId = null;
    this.fragmentBuffers.clear();
    this.notify(null);
    if (!this.stopped && !this.paused) this.scheduleRetry(() => void this.scanAndConnect());
  }

  private handleFrame(value: DataView) {
    let text: string;
    try {
      text = dataViewToText(value);
    } catch {
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (parsed.pt === "telemetry") {
      this.notify(parsed as unknown as BleTelemetryPayload);
      return;
    }
    if (parsed.pt !== "telemetry_fragment") return;
    const seq = Number(parsed.seq);
    const index = Number(parsed.i);
    const total = Number(parsed.n);
    if (!Number.isFinite(seq) || !Number.isFinite(index) || !Number.isFinite(total)) return;
    let buffer = this.fragmentBuffers.get(seq);
    if (!buffer) {
      buffer = new Map();
      this.fragmentBuffers.set(seq, buffer);
    }
    buffer.set(index, String(parsed.d ?? ""));
    if (buffer.size < total) return;
    // Drop any older, still-incomplete sequences -- a dropped BLE notification means that seq will
    // never complete, and holding onto it forever would leak memory over a multi-hour chase.
    for (const key of this.fragmentBuffers.keys()) {
      if (key <= seq) this.fragmentBuffers.delete(key);
    }
    const combined = Array.from({ length: total }, (_, i) => buffer.get(i) ?? "").join("");
    try {
      this.notify(JSON.parse(combined) as BleTelemetryPayload);
    } catch {
      // Corrupted reassembly -- wait for the next sequence rather than publishing garbage.
    }
  }
}

export const bleTelemetryClient = new BleTelemetryClient();
