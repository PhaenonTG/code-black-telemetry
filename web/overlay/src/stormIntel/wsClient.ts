import type { LiveConfig } from "../config/liveConfig";
import { normalizeStormIntelEvent, StormIntelNormalizationError, type NormalizedStormIntelEvent } from "./normalize";
import { stormIntelWsUrl } from "./restClient";

export type StormIntelSocketStatus = "connecting" | "open" | "stale" | "closed";

export interface StormIntelSocketHandlers {
  onEvent(event: NormalizedStormIntelEvent): void;
  onStatusChange(status: StormIntelSocketStatus): void;
  /** Malformed/unexpected messages -- connection stays up, message is just dropped. */
  onMalformedMessage?(error: unknown): void;
}

/**
 * Manages one Core Storm Intel WebSocket connection: reconnect with bounded exponential backoff,
 * stale-connection detection (Core resends every `poll_seconds` -- if nothing arrives for
 * ~2.5x that, the socket is treated as dead even without a close/error event, since a TCP
 * connection can go silent without either firing), and duplicate-event suppression (Core's WS is
 * a fixed-interval resend loop, not change-driven, so the same content arrives repeatedly by
 * design).
 */
export class StormIntelSocket {
  private socket: WebSocket | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs: number;
  private lastMessageAt = 0;
  private lastPayloadJson: string | null = null;
  private closedByCaller = false;
  private status: StormIntelSocketStatus = "closed";

  constructor(
    private readonly config: LiveConfig,
    private readonly handlers: StormIntelSocketHandlers,
  ) {
    this.backoffMs = config.reconnectMinMs;
  }

  start(): void {
    this.closedByCaller = false;
    this.connect();
  }

  stop(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }

  private setStatus(status: StormIntelSocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatusChange(status);
  }

  private connect(): void {
    this.setStatus("connecting");
    let url: string;
    try {
      url = stormIntelWsUrl(this.config);
    } catch (error) {
      // Missing unitId/lat-lon for the selected context -- not a transient failure, don't retry.
      this.handlers.onMalformedMessage?.(error);
      this.setStatus("closed");
      return;
    }

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.lastMessageAt = Date.now();
      this.setStatus("open");
      this.startWatchdog();
    };

    socket.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      if (this.status !== "open") this.setStatus("open");
      this.backoffMs = this.config.reconnectMinMs;

      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch (error) {
        this.handlers.onMalformedMessage?.(error);
        return;
      }
      let normalized: NormalizedStormIntelEvent;
      try {
        normalized = normalizeStormIntelEvent(raw);
      } catch (error) {
        if (error instanceof StormIntelNormalizationError) {
          this.handlers.onMalformedMessage?.(error);
          return;
        }
        throw error;
      }

      const payloadJson = JSON.stringify(normalized.snapshot);
      if (payloadJson === this.lastPayloadJson) return; // duplicate resend, suppress
      this.lastPayloadJson = payloadJson;
      this.handlers.onEvent(normalized);
    };

    socket.onerror = () => {
      // onclose always follows onerror for browser WebSocket; reconnect scheduling lives there.
    };

    socket.onclose = () => {
      if (this.watchdog) {
        clearInterval(this.watchdog);
        this.watchdog = null;
      }
      this.socket = null;
      if (this.closedByCaller) {
        this.setStatus("closed");
        return;
      }
      this.setStatus("closed");
      this.scheduleReconnect();
    };
  }

  private startWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    const staleAfterMs = this.config.pollSeconds * 1000 * 2.5;
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastMessageAt > staleAfterMs) {
        this.setStatus("stale");
        // The socket may still look "open" to the browser while the peer has gone silent --
        // force a reconnect rather than waiting indefinitely for a close event that may never
        // come.
        this.socket?.close();
      }
    }, 1000);
  }

  private scheduleReconnect(): void {
    if (this.closedByCaller) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.config.reconnectMaxMs);
  }
}
