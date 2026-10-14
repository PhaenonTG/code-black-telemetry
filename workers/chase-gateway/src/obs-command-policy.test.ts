import { describe, expect, it, vi } from "vitest";
import { handleRequest, type Env } from "./index";
import { handleProducerStateRequest, type BridgeStorage } from "./producer-bridge";
import { OBS_SCENES, validObsPayload } from "./obs-command-policy";
class Storage implements BridgeStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}
function fixture() {
  const storage = new Storage();
  storage.values.set("status", { receivedAt: new Date().toISOString(), body: { engine: "obs", stateRevision: 4, capabilities: { actions: { scene: ["set"], audio: ["set"], overlay: ["visibility"], recording: ["start", "stop"] } } } });
  storage.values.set("producer-control-lease", { userId: "owner", operator: "Producer", expiresAt: Date.now() + 30000 });
  const post = (action: string, payload: unknown = {}, user = "owner", revision = 4, id = crypto.randomUUID()) => handleProducerStateRequest(new Request("https://x/api/producer/v1/commands", { method: "POST", headers: { "X-Producer-UserId": user }, body: JSON.stringify({ commandId: id, action, payload, expectedStateRevision: revision }) }), storage);
  return { storage, post };
}
describe("OBS command routing", () => {
  it("retains server-verified producer authentication and blocks Meta lifecycle before any Graph request", async () => {
    const { storage } = fixture();
    // Cloudflare accepts streamed Request bodies directly. Node's test runtime
    // additionally requires duplex, so adapt only the test constructor.
    const NativeRequest = globalThis.Request;
    vi.stubGlobal("Request", class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, { ...init, ...(init?.body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);
      }
    });
    const env = { CORE_VPC: { fetch: async () => Response.json({}) }, SUPABASE_URL: "https://qa.supabase.co", SUPABASE_PUBLISHABLE_KEY: "qa-key", PRODUCER_CONTROLS_ENABLED: "true", PRODUCER_OPERATOR_IDS: "owner", PRODUCER_BRIDGE: { idFromName: () => "test", get: () => ({ fetch: (r: Request) => handleProducerStateRequest(r, storage) }) } } as unknown as Env;
    let graphRequests = 0;
    vi.stubGlobal("fetch", async (input: string | Request | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: "owner" });
      if (url.includes("/rest/v1/profiles")) return Response.json([{ active: true, operator_name: "QA" }]);
      graphRequests++; throw Error("Unexpected external request");
    });
    try {
      expect((await handleRequest(new Request("https://x/api/producer/v1/commands", { method: "POST", body: "{}" }), env)).status).toBe(401);
      for (const action of ["prepare", "publish", "end"]) {
        const r = await handleRequest(new Request(`https://x/api/producer/v1/facebook/${action}`, { method: "POST", headers: { Authorization: "Bearer qa-session" }, body: "{}" }), env);
        expect(r.status).toBe(409); expect(await r.json()).toMatchObject({ error: "OBS_FACEBOOK_NOT_QUALIFIED" });
      }
      const body = { commandId: crypto.randomUUID(), action: "obs.audio.set", expectedStateRevision: 4, payload: { muted: true } };
      const call = (env: Env) => handleRequest(new Request("https://x/api/producer/v1/commands", { method: "POST", headers: { Authorization: "Bearer qa-session" }, body: JSON.stringify(body) }), env);
      expect((await call({ ...env, PRODUCER_OPERATOR_IDS: "someone-else" })).status).toBe(403);
      expect((await call(env)).status).toBe(202);
      expect(graphRequests).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });
  it("allows only bounded payloads for fixed scenes, audio, overlay and recording", () => {
    expect(validObsPayload("obs.scene.set", { sceneName: OBS_SCENES[0] })).toBe(true);
    expect(validObsPayload("obs.scene.set", { sceneName: "arbitrary" })).toBe(false);
    expect(validObsPayload("obs.audio.set", { volumeDb: 0, muted: false })).toBe(true);
    for (const p of [{ volumeDb: 1 }, { volumeDb: -61 }, { volumeDb: null }, { muted: "false" }, {}, { muted: true, inputName: "Desktop Audio" }]) expect(validObsPayload("obs.audio.set", p)).toBe(false);
    expect(validObsPayload("obs.overlay.visibility", { enabled: false })).toBe(true);
    expect(validObsPayload("obs.recording.start", {})).toBe(true);
    expect(validObsPayload("obs.recording.start", { directory: "C:/" })).toBe(false);
  });
  it("requires a fresh OBS engine with advertised capabilities and a valid lease", async () => {
    const { storage, post } = fixture();
    expect((await post("obs.scene.set", { sceneName: OBS_SCENES[1] })).status).toBe(202);
    expect((await post("obs.audio.set", { muted: true }, "other")).status).toBe(409);
    expect((await post("obs.audio.set", { muted: true }, "owner", 3)).status).toBe(409);
    storage.values.set("status", { receivedAt: new Date().toISOString(), body: { stateRevision: 4 } });
    expect((await post("obs.recording.start")).status).toBe(409);
  });
  it("allows approved non-owners to stop recording but not start it", async () => {
    const { post } = fixture();
    expect((await post("obs.recording.stop", {}, "other", 0)).status).toBe(202);
    expect((await post("obs.recording.start", {}, "other")).status).toBe(409);
  });
  it("rejects unauthenticated OBS actions, stale capability documents and missing capabilities", async () => {
    const { storage, post } = fixture();
    expect((await post("obs.recording.start", {}, "")).status).toBe(403);
    storage.values.set("status", { receivedAt: new Date(Date.now() - 11000).toISOString(), body: { engine: "obs", stateRevision: 4 } });
    expect((await post("obs.recording.stop")).status).toBe(409);
    storage.values.set("status", { receivedAt: new Date().toISOString(), body: { engine: "obs", stateRevision: 4 } });
    expect((await post("obs.recording.start")).status).toBe(409);
  });
  it("never routes native-only mutations or Facebook start to OBS", async () => {
    const { post } = fixture();
    for (const action of ["lowerThird.hide", "lowerThird.set", "archive.camera.start", "archive.camera.stop", "facebook.output.start"]) expect((await post(action, { text: "test" })).status).toBe(409);
  });
  it("preserves queued command acknowledgement and idempotence", async () => {
    const { storage, post } = fixture(); const id = crypto.randomUUID();
    expect((await post("obs.recording.start", {}, "owner", 4, id)).status).toBe(202);
    expect((await post("obs.recording.start", {}, "owner", 4, id)).status).toBe(200);
    expect((await post("obs.recording.stop", {}, "owner", 4, id)).status).toBe(409);
    const ack = await handleProducerStateRequest(new Request("https://x/api/producer/v1/workstation/ack", { method: "POST", body: JSON.stringify({ commandId: id, state: "succeeded", result: { engine: "obs" } }) }), storage);
    expect(await ack.json()).toMatchObject({ commandId: id, state: "succeeded" });
  });
});
