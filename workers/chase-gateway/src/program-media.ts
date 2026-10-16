import type { BridgeStorage } from "./producer-bridge";
import { COMPOSITION_ID, compositionMatches, programEligible, type MediaStatus } from "./media-proof";
import { requestPreview } from "./preview-demand";

const PREFIX = "/api/producer/v1/preview/hls/";
const NAME = /^program-[0-9a-f]{32}-([0-9]{1,16})\.ts$/;
const SLOTS = 12;
const CHUNK = 96 * 1024;
const MAX_SEGMENT = 512 * 1024;
type Segment = { name: string; size: number; parts: number; capturedAt: string; receivedAt: string; compositionId?: string };
type Manifest = { text: string; names: string[]; previousNames: string[]; capturedAt: string; receivedAt: string; compositionId?: string };
const json = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fresh = (at: string | undefined, max: number) => { const age = at ? Date.now() - Date.parse(at) : NaN; return Number.isFinite(age) && age >= -2000 && age <= max; };
const slot = (name: string) => Number(NAME.exec(name)?.[1]) % SLOTS;

export function parseProgramManifest(text: string): string[] | null {
  if (text.length > 8192 || !text.startsWith("#EXTM3U\n")) return null;
  const names: string[] = [];
  let duration = false; let target = false; let sequence = false;
  for (const raw of text.trim().split("\n").slice(1)) {
    const line = raw.trim();
    if (/^#EXT-X-TARGETDURATION:[1-4]$/.test(line)) { target = true; continue; }
    if (/^#EXT-X-MEDIA-SEQUENCE:\d{1,16}$/.test(line)) { sequence = true; continue; }
    if (/^#EXTINF:(?:[0-3](?:\.\d{1,6})?|4(?:\.0{1,6})?),$/.test(line)) { if (duration || Number(line.slice(8, -1)) <= 0) return null; duration = true; continue; }
    if (/^#EXT-X-VERSION:[3-7]$/.test(line) || line === "#EXT-X-INDEPENDENT-SEGMENTS" || line === "#EXT-X-DISCONTINUITY" || /^#EXT-X-DISCONTINUITY-SEQUENCE:\d+$/.test(line)) continue;
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") && Number.isFinite(Date.parse(line.slice(25)))) continue;
    if (!NAME.test(line) || !duration || !Number.isSafeInteger(Number(NAME.exec(line)![1]))) return null;
    names.push(line); duration = false;
  }
  return target && sequence && !duration && names.length >= 1 && names.length <= 8 && new Set(names).size === names.length ? names : null;
}

export async function handleProgramMedia(request: Request, storage: BridgeStorage): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const match = /^\/api\/producer\/v1\/(workstation\/)?preview\/hls\/(.+)$/.exec(path);
  if (!match) return null;
  const ingest = Boolean(match[1]); const name = match[2];
  if (name !== "index.m3u8" && (!NAME.test(name) || !Number.isSafeInteger(Number(NAME.exec(name)?.[1])))) return json(404, "MEDIA_NOT_FOUND");
  if (ingest && request.method === "POST") {
    const header = request.headers.get("X-Producer-Composition");
    if (header !== null && !COMPOSITION_ID.test(header)) return json(400, "INVALID_COMPOSITION_ID");
    const compositionId = header ?? undefined;
    const status = await storage.get<{ receivedAt: string; body: MediaStatus }>("status");
    if (status?.body.engine === "obs" && (!programEligible(status) || !compositionMatches(status.body, compositionId))) return json(409, "PROGRAM_COMPOSITION_NOT_CURRENT");
    const generation = status?.body.engine === "obs" ? status.body.program?.generation : undefined;
    if (generation && name !== "index.m3u8" && !name.startsWith(`program-${generation}-`)) return json(409, "PROGRAM_GENERATION_NOT_CURRENT");
    const capturedAt = request.headers.get("X-Producer-Frame-At") ?? "";
    if (!fresh(capturedAt, name === "index.m3u8" ? 5000 : 15000)) return json(409, "MEDIA_NOT_CURRENT");
    if (name === "index.m3u8") {
      if (Number(request.headers.get("Content-Length")) > 8192) return json(413, "MANIFEST_TOO_LARGE");
      const text = await request.text(); const names = parseProgramManifest(text);
      if (!names) return json(400, "INVALID_PROGRAM_MANIFEST");
      if (generation && names.some(segment => !segment.startsWith(`program-${generation}-`))) return json(409, "PROGRAM_GENERATION_NOT_CURRENT");
      for (const segment of names) {
        const entry = await storage.get<Segment>(`program-hls-slot-${slot(segment)}`);
        const aligned = entry?.compositionId === compositionId || (status?.body.engine !== "obs" && entry?.compositionId === undefined);
        if (entry?.name !== segment || !aligned || !fresh(entry.capturedAt, 15000)) return json(409, "SEGMENTS_NOT_READY");
      }
      const prior = await storage.get<Manifest>("program-hls-manifest");
      const previousNames = prior?.compositionId === compositionId && (!generation || prior?.names.every(segment => segment.startsWith(`program-${generation}-`))) ? prior?.names ?? [] : [];
      await storage.put("program-hls-manifest", { text, names, previousNames, capturedAt, receivedAt: new Date().toISOString(), compositionId } satisfies Manifest);
    } else {
      if (request.headers.get("Content-Type") !== "video/mp2t" || Number(request.headers.get("Content-Length")) > MAX_SEGMENT) return json(413, "INVALID_MEDIA_SEGMENT");
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_SEGMENT || bytes.byteLength % 188 !== 0) return json(413, "INVALID_MEDIA_SEGMENT");
      const view = new Uint8Array(bytes);
      for (let offset = 0; offset < view.length; offset += 188) if (view[offset] !== 0x47) return json(400, "INVALID_TRANSPORT_STREAM");
      const parts = Math.ceil(bytes.byteLength / CHUNK); const key = `program-hls-slot-${slot(name)}`;
      for (let part = 0; part < parts; part++) await storage.put(`${key}-part-${part}`, bytes.slice(part * CHUNK, (part + 1) * CHUNK));
      await storage.put(key, { name, size: bytes.byteLength, parts, capturedAt, receivedAt: new Date().toISOString(), compositionId } satisfies Segment);
    }
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  if (ingest || request.method !== "GET") return json(405, "METHOD_NOT_ALLOWED");
  if (name === "index.m3u8") await requestPreview(storage, "hls");
  const [status, manifest] = await Promise.all([
    storage.get<{ receivedAt: string; body: MediaStatus }>("status"),
    storage.get<Manifest>("program-hls-manifest"),
  ]);
  if (!programEligible(status, true) || !status || !manifest || !compositionMatches(status.body, manifest.compositionId) || !fresh(manifest.receivedAt, 5000) || !fresh(manifest.capturedAt, 5000)) return json(404, "PROGRAM_MEDIA_NOT_CURRENT");
  const generation = status.body.engine === "obs" ? status.body.program?.generation : undefined;
  if (generation && (manifest.names.some(segment => !segment.startsWith(`program-${generation}-`)) || (name !== "index.m3u8" && !name.startsWith(`program-${generation}-`)))) return json(404, "PROGRAM_GENERATION_NOT_CURRENT");
  const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Producer-Frame-At": manifest.capturedAt, ...(manifest.compositionId ? { "X-Producer-Composition": manifest.compositionId } : {}) };
  if (name === "index.m3u8") {
    const text = manifest.text.split("\n").map(line => NAME.test(line.trim()) ? `${PREFIX}${line.trim()}` : line).join("\n");
    return new Response(text, { headers: { ...headers, "Content-Type": "application/vnd.apple.mpegurl" } });
  }
  if (![...manifest.names, ...manifest.previousNames].includes(name)) return json(404, "MEDIA_NOT_IN_CURRENT_WINDOW");
  const key = `program-hls-slot-${slot(name)}`; const entry = await storage.get<Segment>(key);
  const aligned = entry?.compositionId === manifest.compositionId || (status.body.engine !== "obs" && entry?.compositionId === undefined);
  if (entry?.name !== name || !aligned || !fresh(entry.capturedAt, 15000) || !fresh(entry.receivedAt, 15000)) return json(404, "MEDIA_SEGMENT_EXPIRED");
  const bytes = new Uint8Array(entry.size);
  for (let part = 0; part < entry.parts; part++) {
    const chunk = await storage.get<ArrayBuffer>(`${key}-part-${part}`);
    if (!chunk || chunk.byteLength !== Math.min(CHUNK, entry.size - part * CHUNK)) return json(404, "MEDIA_SEGMENT_INCOMPLETE");
    bytes.set(new Uint8Array(chunk), part * CHUNK);
  }
  return new Response(bytes, { headers: { ...headers, "Content-Type": "video/mp2t" } });
}
