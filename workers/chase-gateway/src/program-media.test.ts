import { describe, expect, it, vi } from "vitest";
import { handleProducerStateRequest, type BridgeStorage } from "./producer-bridge";
import { parseProgramManifest } from "./program-media";
import { handleRequest } from "./index";
class Memory implements BridgeStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T) { if (value instanceof ArrayBuffer && value.byteLength > 96 * 1024) throw new Error("Oversized storage chunk"); this.values.set(key, value); }
}
const name = (index = 0) => `program-${"a".repeat(32)}-${index}.ts`;
const playlist = (names = [name()]) => `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n${names.map(item => `#EXTINF:1.000000,\n#EXT-X-PROGRAM-DATE-TIME:${new Date().toISOString()}\n${item}\n`).join("")}`;
const ts = (packets = 1) => { const bytes = new Uint8Array(188 * packets); for (let offset = 0; offset < bytes.length; offset += 188) bytes[offset] = 0x47; return bytes; };
function fixture() {
  const storage = new Memory();
  storage.values.set("status", { receivedAt: new Date().toISOString(), body: { source_state: "SOURCE_LIVE", previews: { program: { state: "ACTIVE" } }, metrics: { last_video_timestamp: new Date().toISOString() } } });
  const get = (file: string) => handleProducerStateRequest(new Request(`https://x/api/producer/v1/preview/hls/${file}`), storage);
  const put = (file: string, body: BodyInit, capturedAt = new Date().toISOString()) => handleProducerStateRequest(new Request(`https://x/api/producer/v1/workstation/preview/hls/${file}`, { method: "POST", headers: { "Content-Type": file.endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl", "X-Producer-Frame-At": capturedAt }, body }), storage);
  return { storage, get, put };
}
describe("authenticated bounded PROGRAM media", () => {
  it("rejects external URLs, traversal, encryption tags, malformed durations and oversized playlists", () => {
    expect(parseProgramManifest(playlist())).toEqual([name()]);
    for (const text of [playlist(["https://evil.test/key"]), playlist(["../secret.ts"]), `${playlist()}#EXT-X-KEY:METHOD=AES-128,URI=\"https://evil.test\"\n`, playlist().replace("1.000000", "0.000000"), playlist(Array.from({ length: 9 }, (_, i) => name(i)))]) expect(parseProgramManifest(text)).toBeNull();
  });
  it("requires all referenced segments before publishing a manifest and rewrites only same-origin paths", async () => {
    const { put, get } = fixture();
    expect((await put("index.m3u8", playlist())).status).toBe(409);
    expect((await put(name(), ts())).status).toBe(202);
    expect((await put("index.m3u8", playlist())).status).toBe(202);
    const response = await get("index.m3u8");
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.text()).toContain(`/api/producer/v1/preview/hls/${name()}`);
    expect(new Uint8Array(await (await get(name())).arrayBuffer())).toEqual(ts());
  });
  it("chunks large TS segments below storage limits and keeps storage bounded across rotations", async () => {
    const { put, get, storage } = fixture();
    const bytes = ts(2200);
    for (let index = 0; index < 26; index++) {
      expect((await put(name(index), bytes)).status).toBe(202);
      expect((await put("index.m3u8", playlist([name(index)]))).status).toBe(202);
    }
    expect(new Uint8Array(await (await get(name(25))).arrayBuffer())).toEqual(bytes);
    expect(storage.values.size).toBeLessThanOrEqual(86);
    expect((await get(name(0))).status).toBe(404);
  });
  it("never serves stale media, stopped previews, lost sources or stale video health", async () => {
    const { put, get, storage } = fixture();
    await put(name(), ts()); await put("index.m3u8", playlist());
    const original = structuredClone(storage.values.get("status")) as { receivedAt: string; body: { source_state: string; previews: { program: { state: string } }; metrics: { last_video_timestamp: string } } };
    const states = [ { ...original, receivedAt: new Date(Date.now() - 20000).toISOString() }, { ...original, body: { ...original.body, source_state: "SOURCE_LOST" } }, { ...original, body: { ...original.body, previews: { program: { state: "STANDBY" } } } }, { ...original, body: { ...original.body, metrics: { last_video_timestamp: new Date(Date.now() - 10000).toISOString() } } } ];
    for (const state of states) { storage.values.set("status", state); expect((await get("index.m3u8")).status).toBe(404); expect((await get(name())).status).toBe(404); }
    storage.values.set("status", original);
    const manifest = storage.values.get("program-hls-manifest") as Record<string, unknown>;
    manifest.capturedAt = new Date(Date.now() - 10000).toISOString();
    expect((await get("index.m3u8")).status).toBe(404);
  });
  it("rejects malformed packets, oversized segments and stale uploads", async () => {
    const { put } = fixture();
    expect((await put(name(), new Uint8Array(188))).status).toBe(400);
    expect((await put(name(), ts(3000))).status).toBe(413);
    expect((await put(name(), ts(), new Date(Date.now() - 20000).toISOString())).status).toBe(409);
  });
  it("requires OPS auth for playlists and segments, and workstation auth for uploads", async () => {
    const bridge = { idFromName: () => "id", get: () => ({ fetch: () => { throw new Error("Unauthenticated access reached storage"); } }) } as unknown as DurableObjectNamespace;
    for (const file of ["index.m3u8", name()]) {
      expect((await handleRequest(new Request(`https://x/api/producer/v1/preview/hls/${file}`), { PRODUCER_BRIDGE: bridge })).status).toBe(401);
      expect((await handleRequest(new Request(`https://x/api/producer/v1/workstation/preview/hls/${file}`, { method: "POST", body: ts() }), { PRODUCER_BRIDGE: bridge })).status).toBe(401);
    }
  });
  it("accepts active OPS sessions, rejects inactive profiles and legacy unit tokens", async () => {
    const { put, storage } = fixture();
    await put(name(), ts()); await put("index.m3u8", playlist());
    const bridge = { idFromName: () => "id", get: () => ({ fetch: (request: Request) => handleProducerStateRequest(request, storage) }) } as unknown as DurableObjectNamespace;
    const env = { PRODUCER_BRIDGE: bridge, SUPABASE_URL: "https://unit.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public-test", CHASE_TOKEN: "legacy-unit" };
    let active = true;
    vi.stubGlobal("fetch", async (input: string | URL) => String(input).endsWith("/auth/v1/user") ? Response.json({ id: "qa-user" }) : Response.json([{ active, operator_name: "QA" }]));
    try {
      const request = (token: string) => new Request("https://x/api/producer/v1/preview/hls/index.m3u8", { headers: { Authorization: `Bearer ${token}` } });
      expect((await handleRequest(request("ops-session"), env)).status).toBe(200);
      active = false; expect((await handleRequest(request("ops-session"), env)).status).toBe(401);
      expect((await handleRequest(request("legacy-unit"), { PRODUCER_BRIDGE: bridge, CHASE_TOKEN: "legacy-unit" })).status).toBe(401);
    } finally { vi.unstubAllGlobals(); }
  });
});
