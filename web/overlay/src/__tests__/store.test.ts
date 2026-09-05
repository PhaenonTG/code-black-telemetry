import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWebSocket } from "./helpers/fakeWebSocket";

async function loadStoreWithMode(search: string) {
  vi.resetModules();
  vi.stubGlobal("window", { location: { search } });
  const store = await import("../stormIntel/store");
  return store;
}

describe("store mode selection", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to SIMULATION when no mode is specified", async () => {
    const store = await loadStoreWithMode("");
    expect(store.getOverlayMode()).toBe("SIMULATION");
    store.getOverlayProvider().disconnect();
  });

  it("never silently upgrades a plain page load to LIVE_CORE", async () => {
    const store = await loadStoreWithMode("?unitId=cbwx-unit-striker");
    expect(store.getOverlayMode()).toBe("SIMULATION");
    store.getOverlayProvider().disconnect();
  });

  it("selects the live Core provider only when explicitly requested", async () => {
    const store = await loadStoreWithMode("?mode=live_core&coreBaseUrl=https://core.example&coreWsUrl=wss://core.example&unitId=cbwx-unit-striker");
    expect(store.getOverlayMode()).toBe("LIVE_CORE");
    const { RestStormIntelProvider } = await import("../stormIntel/liveProvider");
    expect(store.getOverlayProvider()).toBeInstanceOf(RestStormIntelProvider);
    store.getOverlayProvider().disconnect();
  });

  it("selects the fixture provider and the named sequence when requested", async () => {
    const store = await loadStoreWithMode("?mode=fixture&fixture=tornadic");
    expect(store.getOverlayMode()).toBe("FIXTURE");
    const { FixtureStormIntelProvider } = await import("../stormIntel/fixtureProvider");
    expect(store.getOverlayProvider()).toBeInstanceOf(FixtureStormIntelProvider);
    expect(store.getOverlayProvider().getSnapshot().scenario).toBeDefined();
    store.getOverlayProvider().disconnect();
  });

  it("throws for an unknown fixture name rather than silently falling back", async () => {
    vi.resetModules();
    vi.stubGlobal("window", { location: { search: "?mode=fixture&fixture=does_not_exist" } });
    await expect(import("../stormIntel/store")).rejects.toThrow(/Unknown or missing/);
  });
});
