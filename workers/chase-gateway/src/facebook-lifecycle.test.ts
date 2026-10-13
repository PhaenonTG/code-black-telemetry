import { describe, expect, it, vi } from "vitest";
import { handleFacebookLifecycle, validManagedDestination, type ManagedBroadcast } from "./facebook-lifecycle";
import { handleProducerStateRequest, type BridgeStorage } from "./producer-bridge";

class Storage implements BridgeStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T) { this.values.set(key, value); }
}
const target = "rtmps://live-api-s.facebook.com:443/rtmp/FB-TEST-ONLY-0123456789";
const id = "123456789012345";
const requestId = "067169a4-52c0-4d08-8d7f-638e93ee8451";
const requestId2 = "338274ab-bf75-4f45-8b56-ed5b70d562b5";
const pageId = "650911364781023";
const broadcast: ManagedBroadcast = { id, pageId, title: "QA non-public", description: "QA", status: "UNPUBLISHED", createdAt: new Date().toISOString(), observedAt: new Date().toISOString(), destination: { ciphertext: "encrypted", iv: "iv" } };
function fixture() {
  const storage = new Storage();
  storage.values.set("status", { receivedAt: new Date().toISOString(), body: { stateRevision: 1, source_state: "SOURCE_LIVE", broadcast: { state: "OFF", requested: false }, audio: { process: "RUNNING", available: true, silence: false, clipping: false, lastAudioAt: new Date().toISOString() }, metrics: { last_video_timestamp: new Date().toISOString() } } });
  storage.values.set("producer-control-lease", { userId: "qa", operator: "QA", expiresAt: Date.now() + 30000 });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === "GET" ? { id, status: "UNPUBLISHED" } : { id, secure_stream_url: target })));
  const deps = { credential: async () => ({ pageId, token: "private-page-token", permissions: ["pages_manage_posts"] }), broker: (path: string, init?: RequestInit) => handleProducerStateRequest(new Request(`https://internal${path}`, init), storage), encrypt: async () => ({ ciphertext: "encrypted", iv: "iv" }), decrypt: async () => target, fetch: fetcher, enabled: true };
  const call = (action = "prepare", body: unknown = { requestId, confirmed: true, title: "QA non-public", description: "QA" }, control = true) => handleFacebookLifecycle(new Request(`https://ops/api/producer/v1/facebook/${action}`, { method: "POST", body: JSON.stringify(body) }), "qa", control, false, deps);
  return { storage, deps, fetcher, call };
}
describe("Facebook managed broadcast lifecycle", () => {
  it("pins secure destinations and refuses injected servers or query credentials", () => {
    expect(validManagedDestination(target)).toBe(true);
    for (const value of [target.replace("rtmps", "rtmp"), target.replace("live-api-s.facebook.com", "evil.test"), `${target}?token=secret`, "https://example.test", null]) expect(validManagedDestination(value)).toBe(false);
  });
  it("prepares only UNPUBLISHED and never returns a key to OPS", async () => {
    const { call, fetcher, storage, deps } = fixture();
    const response = await call();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(target); expect(text).not.toContain("encrypted"); expect(text).not.toContain("private-page-token");
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain("status=UNPUBLISHED");
    expect(storage.values.get("facebook-managed-broadcast")).toMatchObject({ id, destination: { ciphertext: "encrypted" } });
    const status = await handleFacebookLifecycle(new Request("https://ops/api/producer/v1/facebook"), "qa", true, false, deps);
    expect(await status.json()).toMatchObject({ enabled: true, broadcast: { id, status: "UNPUBLISHED" } });
    expect((await call()).status).toBe(409); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("requires approved control, permissions, lease, and post details", async () => {
    const { call, deps, fetcher, storage } = fixture();
    expect((await call("prepare", {}, false)).status).toBe(403);
    deps.credential = async () => ({ pageId, token: "private-page-token", permissions: [] });
    expect((await call()).status).toBe(409);
    deps.credential = async () => ({ pageId, token: "private-page-token", permissions: ["pages_manage_posts"] });
    storage.values.delete("producer-control-lease");
    expect((await call()).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not retry uncertain creates or permit another prepare", async () => {
    const { call, fetcher } = fixture();
    fetcher.mockRejectedValue(new Error("timeout"));
    const response = await call();
    expect(await response.json()).toMatchObject({ state: "unknown", error: "META_OUTCOME_UNKNOWN_DO_NOT_RETRY" });
    expect((await call()).status).toBe(409);
    expect((await call("prepare", { requestId: requestId2, confirmed: true, title: "Another", description: "" })).status).toBe(409);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("records rejected Meta calls without leaking error messages", async () => {
    const { call, fetcher } = fixture();
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { code: 4, message: "private-page-token secret response" } }), { status: 403 }));
    const response = await call();
    expect(await response.json()).toMatchObject({ state: "failed", code: 4, error: "META_REJECTED" });
  });
  it("does not hand an encoder destination to the workstation before UNPUBLISHED is verified", async () => {
    const { call, fetcher, deps } = fixture();
    fetcher.mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === "GET" ? { id, status: "LIVE" } : { id, secure_stream_url: target })));
    expect(await (await call()).json()).toMatchObject({ state: "unknown", broadcast: { id, status: "PREPARE_UNCONFIRMED" } });
    const response = await handleFacebookLifecycle(new Request("https://ops/api/producer/v1/workstation/facebook-destination"), undefined, false, true, deps);
    expect(await response.json()).toEqual({ destination: null });
  });
  it("reconciles a known uncertain create with a later observed UNPUBLISHED state", async () => {
    const { call, fetcher } = fixture();
    fetcher.mockImplementation(async (_url, init) => { if (init?.method === "GET") throw new Error("timeout"); return new Response(JSON.stringify({ id, secure_stream_url: target })); });
    expect(await (await call()).json()).toMatchObject({ state: "unknown", broadcast: { id } });
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ id, status: "UNPUBLISHED" })));
    expect(await (await call("refresh", { videoId: id })).json()).toMatchObject({ broadcast: { status: "UNPUBLISHED" } });
  });
  it("requires confirmation and matching fresh video/audio before public publishing", async () => {
    const { call, storage, fetcher } = fixture();
    storage.values.set("facebook-managed-broadcast", broadcast);
    expect((await call("publish", { requestId, confirmed: true, videoId: id, programConfirmed: true })).status).toBe(409);
    const status = storage.values.get("status") as { body: Record<string, unknown> };
    status.body.broadcast = { state: "SENDING", managedVideoId: id, lastSuccessAt: new Date().toISOString() };
    expect((await call("publish", { requestId, confirmed: true, videoId: id, programConfirmed: false })).status).toBe(409);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true })));
    const response = await call("publish", { requestId, confirmed: true, videoId: id, programConfirmed: true });
    expect(await response.json()).toMatchObject({ state: "succeeded", broadcast: { status: "PUBLISH_REQUESTED" } });
    expect(String(fetcher.mock.calls[0][1]?.body)).toBe("status=LIVE_NOW");
  });
  it("ends without a lease and clears the managed encoder destination", async () => {
    const { call, deps, storage, fetcher } = fixture();
    storage.values.set("facebook-managed-broadcast", { ...broadcast, status: "LIVE" }); storage.values.delete("producer-control-lease");
    fetcher.mockResolvedValue(new Response(JSON.stringify({ success: true })));
    const response = await call("end", { requestId, confirmed: true, videoId: id });
    expect(await response.json()).toMatchObject({ state: "succeeded", broadcast: { status: "END_REQUESTED" } });
    expect(String(fetcher.mock.calls[0][1]?.body)).toBe("end_live_video=true");
    const destination = await handleFacebookLifecycle(new Request("https://ops/api/producer/v1/workstation/facebook-destination"), undefined, false, true, deps);
    expect(await destination.json()).toEqual({ destination: null });
  });
  it("reserves shared status refreshes to avoid multiplying Meta calls", async () => {
    const { call, storage, fetcher } = fixture();
    storage.values.set("facebook-managed-broadcast", broadcast);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ id, status: "LIVE" })));
    expect((await call("refresh", { videoId: id })).status).toBe(200);
    expect(await (await call("refresh", { videoId: id })).json()).toMatchObject({ refreshDeferred: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never publishes with stale audio even when the encoder is sending", async () => {
    const { call, storage, fetcher } = fixture();
    storage.values.set("facebook-managed-broadcast", broadcast);
    const status = storage.values.get("status") as { body: Record<string, unknown> };
    status.body.broadcast = { state: "SENDING", managedVideoId: id, lastSuccessAt: new Date().toISOString() };
    status.body.audio = { process: "RUNNING", available: true, lastAudioAt: new Date(Date.now() - 20000).toISOString() };
    expect((await call("publish", { requestId, confirmed: true, videoId: id, programConfirmed: true })).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
