import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveConfig } from "../config/liveConfig";
import { RestStormIntelProvider } from "../stormIntel/liveProvider";
import { FakeWebSocket, wireStormIntelEvent } from "./helpers/fakeWebSocket";

function wireSnapshotBody() {
  return wireStormIntelEvent().payload;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

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
    fixture: null,
    reconnectMinMs: 1000,
    reconnectMaxMs: 8000,
    pollSeconds: 30,
    ...overrides,
  };
}

describe("RestStormIntelProvider", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in an explicit unavailable state before the REST bootstrap resolves", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})), // never resolves within this test
    );
    const provider = new RestStormIntelProvider(config());
    const snapshot = provider.getSnapshot();
    expect(snapshot.snapshot.available).toBe(false);
    expect(snapshot.snapshot.simulation).toBe(false);
    provider.disconnect();
  });

  it("applies a successful REST bootstrap snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(wireSnapshotBody())));
    const provider = new RestStormIntelProvider(config());
    await vi.waitFor(() => expect(provider.getSnapshot().snapshot.providerName).toBe("hrrr-nomads"));
    provider.disconnect();
  });

  it("never falls back to simulated data on total failure -- no silent simulation fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false, 503)));
    const provider = new RestStormIntelProvider(config());
    await vi.waitFor(() => expect(provider.getSnapshot().snapshot.available).toBe(false));
    const snapshot = provider.getSnapshot().snapshot;
    expect(snapshot.simulation).toBe(false);
    expect(snapshot.providerName).not.toBe("simulation");
    expect(snapshot.unavailableReason).toBeTruthy();
    provider.disconnect();
  });

  it("applies live snapshots pushed over the WebSocket", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const provider = new RestStormIntelProvider(config());
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage(wireStormIntelEvent());
    await vi.waitFor(() => expect(provider.getSnapshot().snapshot.providerName).toBe("hrrr-nomads"));
    provider.disconnect();
  });

  it("marks the snapshot unavailable when the connection goes stale, never freezing old data silently", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const provider = new RestStormIntelProvider(config());
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage(wireStormIntelEvent({ payload: { ...wireStormIntelEvent().payload, available: true } }));
    await vi.waitFor(() => expect(provider.getSnapshot().snapshot.available).toBe(true));

    ws.close(); // server-side disconnect
    await vi.waitFor(() => expect(provider.getSnapshot().snapshot.available).toBe(false));
    expect(provider.getSnapshot().snapshot.unavailableReason).toMatch(/reconnecting/i);
    provider.disconnect();
  });

  it("supports triggerTakeover/dismissTakeover identically to the simulator", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(wireSnapshotBody())));
    const provider = new RestStormIntelProvider(config());
    provider.triggerTakeover("TOR_WARNING");
    expect(provider.getSnapshot().takeover?.kind).toBe("TOR_WARNING");
    provider.dismissTakeover();
    expect(provider.getSnapshot().takeover).toBeNull();
    provider.disconnect();
  });

  it("reports the hodograph as unavailable -- Core has no vertical-profile endpoint yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(wireSnapshotBody())));
    const provider = new RestStormIntelProvider(config());
    await vi.waitFor(() => expect(provider.getSnapshot().snapshot.providerName).toBe("hrrr-nomads"));
    expect(provider.getSnapshot().hodograph.levels).toHaveLength(0);
    expect(provider.getSnapshot().hodograph.freshness).toBe("unavailable");
    provider.disconnect();
  });
});
