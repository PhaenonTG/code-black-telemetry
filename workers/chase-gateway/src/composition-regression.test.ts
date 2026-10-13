import { describe, expect, it } from "vitest";
import { handleProducerStateRequest, type BridgeStorage } from "./producer-bridge";
class Memory implements BridgeStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T) { this.values.set(key, value); }
}
const id = "a".repeat(24), other = "b".repeat(24);
const name = (i: number) => `program-${"c".repeat(32)}-${i}.ts`;
const manifest = (i: number) => `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${i}\n#EXTINF:1.0,\n${name(i)}\n`;
function fixture() {
  const storage = new Memory();
  const status = { receivedAt: new Date().toISOString(), body: { stateRevision: 1, source_state: "SOURCE_LIVE", previews: { program: { state: "ACTIVE" } }, metrics: { last_video_timestamp: new Date().toISOString() }, composition: undefined as { id: string } | undefined } };
  storage.values.set("status", status);
  const request = (path: string, body?: BodyInit, composition?: string) => handleProducerStateRequest(new Request(`https://x/api/producer/v1/${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": path.endsWith(".jpg") ? "image/jpeg" : path.endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl", "X-Producer-Frame-At": new Date().toISOString(), ...(composition === undefined ? {} : { "X-Producer-Composition": composition }) }, body }), storage);
  const segment = new Uint8Array(188); segment[0] = 0x47;
  return { storage, status, request, segment };
}
describe("composition-aware compatible media relay", () => {
  it("preserves legacy no-ID JPEG and HLS and fails closed once a composition is advertised", async () => {
    const { request, status, segment } = fixture();
    await request("workstation/preview/program.jpg", new Uint8Array([1]));
    expect((await request("preview/program.jpg")).status).toBe(200);
    await request(`workstation/preview/hls/${name(0)}`, segment);
    await request("workstation/preview/hls/index.m3u8", manifest(0));
    expect((await request("preview/hls/index.m3u8")).status).toBe(200);
    status.body.composition = { id };
    expect((await request("preview/program.jpg")).status).toBe(404);
    expect((await request("preview/hls/index.m3u8")).status).toBe(404);
    await request("workstation/preview/program.jpg", new Uint8Array([1]), id);
    await request("workstation/preview/hls/index.m3u8", manifest(0), id);
    expect((await request("preview/program.jpg")).headers.get("X-Producer-Composition")).toBe(id);
    expect((await request("preview/hls/index.m3u8")).status).toBe(200);
    status.body.composition.id = other;
    expect((await request(`preview/hls/${name(0)}`)).status).toBe(404);
  });
  it("rejects malformed composition IDs in JPEG and manifest uploads", async () => {
    const { request, segment } = fixture();
    await request(`workstation/preview/hls/${name(0)}`, segment);
    for (const value of ["", "x", "A".repeat(24), "a".repeat(25)]) {
      expect((await request("workstation/preview/program.jpg", new Uint8Array([1]), value)).status).toBe(400);
      expect((await request("workstation/preview/hls/index.m3u8", manifest(0), value)).status).toBe(400);
    }
  });
  it("retains the previous HLS window only within the same composition", async () => {
    const { request, status, segment } = fixture(); status.body.composition = { id };
    for (let i = 0; i < 2; i++) { await request(`workstation/preview/hls/${name(i)}`, segment); await request("workstation/preview/hls/index.m3u8", manifest(i), id); }
    expect((await request(`preview/hls/${name(0)}`)).status).toBe(200);
    await request(`workstation/preview/hls/${name(2)}`, segment);
    await request("workstation/preview/hls/index.m3u8", manifest(2), other);
    status.body.composition = { id: other };
    expect((await request(`preview/hls/${name(1)}`)).status).toBe(404);
    expect((await request(`preview/hls/${name(2)}`)).status).toBe(200);
  });
  it("validates overlay.set and returns a command acknowledgment without touching output", async () => {
    const { storage } = fixture();
    const command = { commandId: "2bd3ed52-786b-4ead-a77a-a6438fd9b772", expectedStateRevision: 1, action: "overlay.set", payload: { bug: { enabled: false }, callsign: "NICK" } };
    const send = (body: unknown) => handleProducerStateRequest(new Request("https://x/api/producer/v1/commands", { method: "POST", body: JSON.stringify(body) }), storage);
    expect((await send({ ...command, payload: { source: "private-file" } })).status).toBe(400);
    expect((await send(command)).status).toBe(202);
    expect((await send(command)).status).toBe(200);
    expect(await storage.get("commands")).toMatchObject([{ action: "overlay.set", state: "queued" }]);
    const ack = await handleProducerStateRequest(new Request("https://x/api/producer/v1/workstation/ack", { method: "POST", body: JSON.stringify({ commandId: command.commandId, state: "succeeded", result: { stateRevision: 2 } }) }), storage);
    expect(ack.status).toBe(200);
    expect(await ack.json()).toMatchObject({ action: "overlay.set", state: "succeeded", result: { stateRevision: 2 } });
  });
});
