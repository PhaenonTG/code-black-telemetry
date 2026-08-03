import { BleClient, dataViewToText, type BleDevice } from "@capacitor-community/bluetooth-le";

// Protocol contract lives on the Pi at ~/CodeBlack/docs/BLE_PROTOCOL.md (codeblack_ble/payloads.py
// is the source of truth). Compact JSON over a notify characteristic, fragmented into
// telemetry_fragment frames keyed by seq/i/n when the payload exceeds CB_BLE_MAX_PAYLOAD_BYTES.
const SERVICE_UUID = "8f2a0000-6d6f-4f9f-9d8b-0c0d2b4c0001";
const TELEMETRY_CHARACTERISTIC_UUID = "8f2a0003-6d6f-4f9f-9d8b-0c0d2b4c0001";
const SCAN_TIMEOUT_MS = 10_000;
const RECONNECT_DELAY_MS = 5_000;

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
  private initialized = false;
  private fragmentBuffers = new Map<number, Map<number, string>>();

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    void this.run();
  }

  stop() {
    this.stopped = true;
    this.started = false;
    if (this.deviceId) void BleClient.disconnect(this.deviceId).catch(() => {});
    this.deviceId = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
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
    if (!this.initialized) {
      try {
        await BleClient.initialize({ androidNeverForLocation: true });
        this.initialized = true;
      } catch {
        // No BLE radio, permission denied, or unsupported platform -- retry on the same cadence
        // as a failed scan rather than giving up permanently (permission can be granted later).
        if (!this.stopped) window.setTimeout(() => void this.run(), RECONNECT_DELAY_MS);
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
    if (this.stopped) return;
    try {
      const device = await this.scanForDevice();
      if (!device) {
        if (!this.stopped) window.setTimeout(() => void this.scanAndConnect(), RECONNECT_DELAY_MS);
        return;
      }
      await BleClient.connect(device.deviceId, () => this.handleDisconnect());
      this.deviceId = device.deviceId;
      this.connected = true;
      this.notify(null);
      await BleClient.startNotifications(device.deviceId, SERVICE_UUID, TELEMETRY_CHARACTERISTIC_UUID, (value) => this.handleFrame(value));
    } catch {
      if (!this.stopped) window.setTimeout(() => void this.scanAndConnect(), RECONNECT_DELAY_MS);
    }
  }

  private handleDisconnect() {
    this.connected = false;
    this.deviceId = null;
    this.fragmentBuffers.clear();
    this.notify(null);
    if (!this.stopped) window.setTimeout(() => void this.scanAndConnect(), RECONNECT_DELAY_MS);
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
