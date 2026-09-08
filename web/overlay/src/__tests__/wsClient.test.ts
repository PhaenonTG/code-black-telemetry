import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveConfig } from "../config/liveConfig";
import { StormIntelSocket, type StormIntelSocketStatus } from "../stormIntel/wsClient";
import { FakeWebSocket, wireStormIntelEvent as wireEvent } from "./helpers/fakeWebSocket";

function config(overrides: Partial<LiveConfig> = {}): LiveConfig {
  return {
    mode: "LIVE_CORE",
    coreBaseUrl: "https://core.example",
    coreWsUrl: "wss://core.example",
    contextType: "AT_UNIT",
    unitId: "cbwx-unit-striker",
    aheadDistanceMiles: null,
    latitude: null,
    longitude: null,
    publicIdentity: null,
    vehicleTag: null,
    fixture: null,
    reconnectMinMs: 1000,
    reconnectMaxMs: 8000,
    pollSeconds: 10,
    ...overrides,
  };
}

describe("StormIntelSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects to the real Storm Intel WS route with unit_id and poll_seconds", () => {
    const socket = new StormIntelSocket(config(), { onEvent: vi.fn(), onStatusChange: vi.fn() });
    socket.start();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const url = FakeWebSocket.instances[0].url;
    expect(url).toContain("/api/storm-intel/v1/ws");
    expect(url).toContain("unit_id=cbwx-unit-striker");
    expect(url).toContain("poll_seconds=10");
    socket.stop();
  });

  it("emits a normalized event for a valid message and reports status transitions", () => {
    const onEvent = vi.fn();
    const statuses: StormIntelSocketStatus[] = [];
    const socket = new StormIntelSocket(config(), { onEvent, onStatusChange: (s) => statuses.push(s) });
    socket.start();
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage(wireEvent());

    expect(statuses).toEqual(["connecting", "open"]);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].contextKey).toBe("unit:cbwx-unit-striker");
    socket.stop();
  });

  it("suppresses a duplicate resend of identical content (Core's WS is a fixed-interval resend loop)", () => {
    const onEvent = vi.fn();
    const socket = new StormIntelSocket(config(), { onEvent, onStatusChange: vi.fn() });
    socket.start();
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage(wireEvent());
    ws.simulateMessage(wireEvent()); // identical content, resent verbatim
    expect(onEvent).toHaveBeenCalledTimes(1);
    socket.stop();
  });

  it("does not suppress a genuinely changed payload", () => {
    const onEvent = vi.fn();
    const socket = new StormIntelSocket(config(), { onEvent, onStatusChange: vi.fn() });
    socket.start();
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage(wireEvent());
    ws.simulateMessage(
      wireEvent({ payload: { ...wireEvent().payload, generated_at: "2026-06-04T21:05:00Z" } }),
    );
    expect(onEvent).toHaveBeenCalledTimes(2);
    socket.stop();
  });

  it("drops a malformed message without crashing or emitting, and keeps the connection open", () => {
    const onEvent = vi.fn();
    const onMalformedMessage = vi.fn();
    const statuses: StormIntelSocketStatus[] = [];
    const socket = new StormIntelSocket(config(), {
      onEvent,
      onStatusChange: (s) => statuses.push(s),
      onMalformedMessage,
    });
    socket.start();
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateRawMessage("{not valid json");
    ws.simulateMessage(wireEvent({ event_type: "unexpected.type" }));

    expect(onEvent).not.toHaveBeenCalled();
    expect(onMalformedMessage).toHaveBeenCalledTimes(2);
    expect(statuses).not.toContain("closed");
    socket.stop();
  });

  it("reconnects with bounded exponential backoff after the socket closes", () => {
    const socket = new StormIntelSocket(config({ reconnectMinMs: 1000, reconnectMaxMs: 5000 }), {
      onEvent: vi.fn(),
      onStatusChange: vi.fn(),
    });
    socket.start();
    FakeWebSocket.instances[0].simulateOpen();
    FakeWebSocket.instances[0].close(); // simulate server-side disconnect

    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1); // not yet
    vi.advanceTimersByTime(2);
    expect(FakeWebSocket.instances).toHaveLength(2); // reconnected at ~1000ms

    FakeWebSocket.instances[1].close();
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2); // backoff doubled to ~2000ms, not yet
    vi.advanceTimersByTime(2);
    expect(FakeWebSocket.instances).toHaveLength(3);
    socket.stop();
  });

  it("detects a stale connection (no messages for ~2.5x poll_seconds) even without a close event", () => {
    const statuses: StormIntelSocketStatus[] = [];
    const socket = new StormIntelSocket(config({ pollSeconds: 10 }), {
      onEvent: vi.fn(),
      onStatusChange: (s) => statuses.push(s),
    });
    socket.start();
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    // 2.5 * 10s = 25s with no message at all -- peer went silent without closing the socket.
    vi.advanceTimersByTime(26_000);
    expect(statuses).toContain("stale");
    socket.stop();
  });

  it("stops permanently when the caller calls stop() -- does not reconnect", () => {
    const socket = new StormIntelSocket(config(), { onEvent: vi.fn(), onStatusChange: vi.fn() });
    socket.start();
    FakeWebSocket.instances[0].simulateOpen();
    socket.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
