import { describe, expect, it, vi } from "vitest";
import { handleProducerStateRequest, type BridgeStorage } from "./producer-bridge";
import { parseProgramManifest } from "./program-media";
import { handleRequest, type Env } from "./index";
class Storage implements BridgeStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async put<T>(key: string, value: T) { this.values.set(key, value); }
}
const id = "a".repeat(24), gen = "b".repeat(32), otherGen = "c".repeat(32);
const name = (generation = gen, n = 0) => `program-${generation}-${n}.ts`;
const manifest = (generation = gen, n = 0) => `#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:${n}\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXTINF:1.000000,\n${name(generation,n)}\n`;
function fixture() {
  const storage = new Storage();
  const body = { engine: "obs", observedAt: new Date().toISOString(), source_state: "SOURCE_LOST", composition: { id }, program: { state: "RENDERING", compositionId: id, generation: gen, lastFrameAt: new Date().toISOString() }, previews: { program: { state: "ACTIVE" } } };
  storage.values.set("status", { receivedAt: new Date().toISOString(), body });
  const put = (file: string, content: BodyInit, composition: string | null = id) => handleProducerStateRequest(new Request(`https://x/api/producer/v1/workstation/preview/${file}`, { method: "POST", headers: { "Content-Type": file.endsWith(".ts") ? "video/mp2t" : file.endsWith(".jpg") ? "image/jpeg" : "application/vnd.apple.mpegurl", "X-Producer-Frame-At": new Date().toISOString(), ...(composition === null ? {} : { "X-Producer-Composition": composition }) }, body: content }), storage);
  const get = (file: string) => handleProducerStateRequest(new Request(`https://x/api/producer/v1/preview/${file}`), storage);
  const packets = new Uint8Array(188); packets[0] = 0x47;
  const publish = async (generation = gen, n = 0) => { expect((await put("hls/"+name(generation,n),packets)).status).toBe(202);expect((await put("hls/index.m3u8",manifest(generation,n))).status).toBe(202); };
  return { storage, body, put, get, packets, publish };
}
describe("OBS PROGRAM media compatibility", () => {
  it("forwards composition headers through authenticated workstation routing, including invalid empty values", async () => {
    const {storage,packets}=fixture(),NativeRequest=globalThis.Request;
    vi.stubGlobal("Request",class extends NativeRequest { constructor(input:RequestInfo|URL,init?:RequestInit){super(input,{...init,...(init?.body instanceof ReadableStream?{duplex:"half"}:{})} as RequestInit);} });
    const env={PRODUCER_BRIDGE_TOKEN:"test-workstation",PRODUCER_BRIDGE:{idFromName:()=>"test",get:()=>({fetch:(r:Request)=>handleProducerStateRequest(r,storage)})}} as unknown as Env;
    try {
      for(const composition of [id,""]){const r=await handleRequest(new Request("https://x/api/producer/v1/workstation/preview/hls/"+name(),{method:"POST",headers:{Authorization:"Bearer test-workstation","Content-Type":"video/mp2t","X-Producer-Frame-At":new Date().toISOString(),"X-Producer-Composition":composition},body:packets}),env);expect(r.status).toBe(composition?202:400);}
    }finally{vi.unstubAllGlobals();}
  });
  it("parses the independent-segments tag emitted by real OBS HLS", () => expect(parseProgramManifest(manifest())).toEqual([name()]));
  it("serves current OBS PROGRAM without manufacturing a live camera", async () => {
    const { publish, get, body } = fixture();await publish();
    for (const file of ["hls/index.m3u8","hls/"+name()]) { const r=await get(file);expect(r.status).toBe(200);expect(r.headers.get("X-Producer-Composition")).toBe(id); }
    expect(body.source_state).toBe("SOURCE_LOST");
  });
  it("rejects missing, empty, malformed or mismatched OBS composition headers", async () => {
    const { put, packets } = fixture();
    for (const value of [null,"","bad","A".repeat(24),"d".repeat(24)]) for (const file of ["hls/"+name(),"hls/index.m3u8","program.jpg"]) expect((await put(file,packets,value)).status).toBe(value===null||value==="d".repeat(24)?409:400);
  });
  it("requires fresh matching render proof even when the camera says live", async () => {
    const { body, get, publish }=fixture();await publish();body.source_state="SOURCE_LIVE";
    body.program.lastFrameAt=new Date(Date.now()-6000).toISOString();expect((await get("hls/index.m3u8")).status).toBe(404);
    body.program.lastFrameAt=new Date().toISOString();body.program.compositionId="d".repeat(24);expect((await get("hls/index.m3u8")).status).toBe(404);
    body.program.compositionId=id;body.observedAt=new Date(Date.now()-6000).toISOString();expect((await get("hls/index.m3u8")).status).toBe(404);
  });
  it("keeps only the current and previous same-generation manifest windows", async () => {
    const { body, publish, get, put, packets }=fixture();await publish();await publish(gen,1);await publish(gen,2);
    expect((await get("hls/"+name(gen,0))).status).toBe(404);expect((await get("hls/"+name(gen,1))).status).toBe(200);
    body.program.generation=otherGen;expect((await get("hls/index.m3u8")).status).toBe(404);await publish(otherGen);
    expect((await get("hls/"+name(gen,2))).status).toBe(404);expect((await put("hls/"+name(gen,3),packets)).status).toBe(409);
  });
  it("invalidates cached JPEG immediately on composition change or preview stop", async () => {
    const { put,get,body }=fixture();expect((await put("program.jpg",new Uint8Array([255,216,255,217]))).status).toBe(202);expect((await get("program.jpg")).status).toBe(200);
    body.composition.id=body.program.compositionId="d".repeat(24);expect((await get("program.jpg")).status).toBe(404);
    body.composition.id=body.program.compositionId=id;body.previews.program.state="OFF";expect((await get("program.jpg")).status).toBe(404);
  });
  it("retains native JPEG and HLS without composition IDs", async () => {
    const { storage, put, get, packets }=fixture();storage.values.set("status",{receivedAt:new Date().toISOString(),body:{source_state:"SOURCE_LIVE",previews:{program:{state:"ACTIVE"}},metrics:{last_video_timestamp:new Date().toISOString()}}});
    expect((await put("program.jpg",new Uint8Array([255,216,255,217]),null)).status).toBe(202);expect((await get("program.jpg")).status).toBe(200);
    expect((await put("hls/"+name(),packets,null)).status).toBe(202);expect((await put("hls/index.m3u8",manifest(),null)).status).toBe(202);expect((await get("hls/index.m3u8")).status).toBe(200);
  });
  it("supports native uploaders that tag manifests but not individual segments", async () => {
    const {storage,put,get,packets}=fixture();storage.values.set("status",{receivedAt:new Date().toISOString(),body:{source_state:"SOURCE_LIVE",composition:{id},previews:{program:{state:"ACTIVE"}},metrics:{last_video_timestamp:new Date().toISOString()}}});
    expect((await put("hls/"+name(),packets,null)).status).toBe(202);expect((await put("hls/index.m3u8",manifest(),id)).status).toBe(202);
    expect((await get("hls/index.m3u8")).status).toBe(200);expect((await get("hls/"+name())).status).toBe(200);
  });
});
