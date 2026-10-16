import { describe, expect, it, vi } from "vitest";
import { handleProducerStateRequest, ProducerBridge, type BridgeStorage } from "./producer-bridge";

class Storage implements BridgeStorage {
  values = new Map<string, unknown>(); writes: string[] = [];
  async get<T>(key: string) { return structuredClone(this.values.get(key)) as T | undefined; }
  async put<T>(key: string, value: T) { this.writes.push(key); this.values.set(key, structuredClone(value)); }
}
const call = (store: Storage, path: string, body?: unknown) => handleProducerStateRequest(new Request(`https://x/api/producer/v1/${path}`, { method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), store);

describe("quota-safe heartbeat", () => {
  it("keeps status fresh, deduplicates capabilities and performs no empty-command writes", async () => {
    const store = new Storage();
    const body = { status: { engine: "obs", stateRevision: 3 }, capabilities: { engine: "obs" } };
    expect(await (await call(store, "workstation/heartbeat", body)).json()).toEqual({ commands: [], previewDemandMs: { jpeg: 0, hls: 0 } });
    await call(store, "workstation/heartbeat", body);
    await call(store, "workstation/commands");
    expect(store.writes).toEqual(["status", "capabilities", "status"]);
    expect(await (await call(store, "capabilities")).json()).toMatchObject({ bridge: "ONLINE", capabilities: body.capabilities });
  });
  it("rejects malformed heartbeats before changing state", async () => {
    const store = new Storage();
    expect((await call(store, "workstation/heartbeat", { status: [], capabilities: {} })).status).toBe(400);
    expect(store.writes).toEqual([]);
  });
  it("wakes only requested media, throttles demand writes and never serves stale media", async () => {
    vi.useFakeTimers();
    try {
      const store = new Storage(); const body = { status: {}, capabilities: {} };
      expect((await call(store, "preview/program.jpg")).status).toBe(404);
      await call(store, "preview/program.jpg");
      expect(store.writes).toEqual(["producer-preview-demand"]);
      expect(await (await call(store, "workstation/heartbeat", body)).json()).toMatchObject({ previewDemandMs: { jpeg: 20000, hls: 0 } });
      expect((await call(store, "preview/hls/index.m3u8")).status).toBe(404);
      vi.advanceTimersByTime(20001);
      expect(await (await call(store, "workstation/heartbeat", body)).json()).toMatchObject({ previewDemandMs: { jpeg: 0, hls: 0 } });
    } finally { vi.useRealTimers(); }
  });
  it("one storage exception cannot poison later requests or replay failed writes", async () => {
    const store = new Storage(); let attempts = 0;
    store.put = async () => { attempts++; throw Error("private-secret-must-not-log"); };
    const bridge = new ProducerBridge({ storage: store } as unknown as DurableObjectState);
    expect((await bridge.fetch(new Request("https://x/api/producer/v1/workstation/status", { method: "POST", body: "{}" }))).status).toBe(503);
    expect((await bridge.fetch(new Request("https://x/api/producer/v1/status"))).status).toBe(200);
    expect(attempts).toBe(1);
  });
});
