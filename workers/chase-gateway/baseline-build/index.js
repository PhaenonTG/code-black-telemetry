var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/media-proof.ts
var COMPOSITION_ID = /^[a-f0-9]{24}$/;
var MEDIA_GENERATION = /^[a-f0-9]{32}$/;
function mediaFresh(at, max) {
  const age = at ? Date.now() - Date.parse(at) : NaN;
  return Number.isFinite(age) && age >= -2e3 && age <= max;
}
__name(mediaFresh, "mediaFresh");
function compositionMatches(body, mediaId) {
  const id = body.composition?.id;
  if (id === void 0) return body.engine !== "obs";
  return typeof id === "string" && COMPOSITION_ID.test(id) && mediaId === id;
}
__name(compositionMatches, "compositionMatches");
function programEligible(status, legacyHls = false) {
  if (!status || !mediaFresh(status.receivedAt, 1e4)) return false;
  const body = status.body;
  if (body.engine !== "obs") return body.source_state === "SOURCE_LIVE" && (!legacyHls || body.previews?.program?.state === "ACTIVE" && mediaFresh(body.metrics?.last_video_timestamp, 5e3));
  const id = body.composition?.id, program = body.program;
  return typeof id === "string" && COMPOSITION_ID.test(id) && body.previews?.program?.state === "ACTIVE" && mediaFresh(body.observedAt, 5e3) && program?.state === "RENDERING" && program.compositionId === id && typeof program.generation === "string" && MEDIA_GENERATION.test(program.generation) && mediaFresh(program.lastFrameAt, 5e3);
}
__name(programEligible, "programEligible");

// src/program-media.ts
var PREFIX = "/api/producer/v1/preview/hls/";
var NAME = /^program-[0-9a-f]{32}-([0-9]{1,16})\.ts$/;
var SLOTS = 12;
var CHUNK = 96 * 1024;
var MAX_SEGMENT = 512 * 1024;
var json = /* @__PURE__ */ __name((status, error) => new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }), "json");
var fresh = /* @__PURE__ */ __name((at, max) => {
  const age = at ? Date.now() - Date.parse(at) : NaN;
  return Number.isFinite(age) && age >= -2e3 && age <= max;
}, "fresh");
var slot = /* @__PURE__ */ __name((name) => Number(NAME.exec(name)?.[1]) % SLOTS, "slot");
function parseProgramManifest(text) {
  if (text.length > 8192 || !text.startsWith("#EXTM3U\n")) return null;
  const names = [];
  let duration = false;
  let target = false;
  let sequence = false;
  for (const raw of text.trim().split("\n").slice(1)) {
    const line = raw.trim();
    if (/^#EXT-X-TARGETDURATION:[1-4]$/.test(line)) {
      target = true;
      continue;
    }
    if (/^#EXT-X-MEDIA-SEQUENCE:\d{1,16}$/.test(line)) {
      sequence = true;
      continue;
    }
    if (/^#EXTINF:(?:[0-3](?:\.\d{1,6})?|4(?:\.0{1,6})?),$/.test(line)) {
      if (duration || Number(line.slice(8, -1)) <= 0) return null;
      duration = true;
      continue;
    }
    if (/^#EXT-X-VERSION:[3-7]$/.test(line) || line === "#EXT-X-INDEPENDENT-SEGMENTS" || line === "#EXT-X-DISCONTINUITY" || /^#EXT-X-DISCONTINUITY-SEQUENCE:\d+$/.test(line)) continue;
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") && Number.isFinite(Date.parse(line.slice(25)))) continue;
    if (!NAME.test(line) || !duration || !Number.isSafeInteger(Number(NAME.exec(line)[1]))) return null;
    names.push(line);
    duration = false;
  }
  return target && sequence && !duration && names.length >= 1 && names.length <= 8 && new Set(names).size === names.length ? names : null;
}
__name(parseProgramManifest, "parseProgramManifest");
async function handleProgramMedia(request, storage) {
  const path = new URL(request.url).pathname;
  const match = /^\/api\/producer\/v1\/(workstation\/)?preview\/hls\/(.+)$/.exec(path);
  if (!match) return null;
  const ingest = Boolean(match[1]);
  const name = match[2];
  if (name !== "index.m3u8" && (!NAME.test(name) || !Number.isSafeInteger(Number(NAME.exec(name)?.[1])))) return json(404, "MEDIA_NOT_FOUND");
  if (ingest && request.method === "POST") {
    const header = request.headers.get("X-Producer-Composition");
    if (header !== null && !COMPOSITION_ID.test(header)) return json(400, "INVALID_COMPOSITION_ID");
    const compositionId = header ?? void 0;
    const status2 = await storage.get("status");
    if (status2?.body.engine === "obs" && (!programEligible(status2) || !compositionMatches(status2.body, compositionId))) return json(409, "PROGRAM_COMPOSITION_NOT_CURRENT");
    const generation2 = status2?.body.engine === "obs" ? status2.body.program?.generation : void 0;
    if (generation2 && name !== "index.m3u8" && !name.startsWith(`program-${generation2}-`)) return json(409, "PROGRAM_GENERATION_NOT_CURRENT");
    const capturedAt = request.headers.get("X-Producer-Frame-At") ?? "";
    if (!fresh(capturedAt, name === "index.m3u8" ? 5e3 : 15e3)) return json(409, "MEDIA_NOT_CURRENT");
    if (name === "index.m3u8") {
      if (Number(request.headers.get("Content-Length")) > 8192) return json(413, "MANIFEST_TOO_LARGE");
      const text = await request.text();
      const names = parseProgramManifest(text);
      if (!names) return json(400, "INVALID_PROGRAM_MANIFEST");
      if (generation2 && names.some((segment) => !segment.startsWith(`program-${generation2}-`))) return json(409, "PROGRAM_GENERATION_NOT_CURRENT");
      for (const segment of names) {
        const entry2 = await storage.get(`program-hls-slot-${slot(segment)}`);
        const aligned2 = entry2?.compositionId === compositionId || status2?.body.engine !== "obs" && entry2?.compositionId === void 0;
        if (entry2?.name !== segment || !aligned2 || !fresh(entry2.capturedAt, 15e3)) return json(409, "SEGMENTS_NOT_READY");
      }
      const prior = await storage.get("program-hls-manifest");
      const previousNames = prior?.compositionId === compositionId && (!generation2 || prior?.names.every((segment) => segment.startsWith(`program-${generation2}-`))) ? prior?.names ?? [] : [];
      await storage.put("program-hls-manifest", { text, names, previousNames, capturedAt, receivedAt: (/* @__PURE__ */ new Date()).toISOString(), compositionId });
    } else {
      if (request.headers.get("Content-Type") !== "video/mp2t" || Number(request.headers.get("Content-Length")) > MAX_SEGMENT) return json(413, "INVALID_MEDIA_SEGMENT");
      const bytes2 = await request.arrayBuffer();
      if (!bytes2.byteLength || bytes2.byteLength > MAX_SEGMENT || bytes2.byteLength % 188 !== 0) return json(413, "INVALID_MEDIA_SEGMENT");
      const view = new Uint8Array(bytes2);
      for (let offset = 0; offset < view.length; offset += 188) if (view[offset] !== 71) return json(400, "INVALID_TRANSPORT_STREAM");
      const parts = Math.ceil(bytes2.byteLength / CHUNK);
      const key2 = `program-hls-slot-${slot(name)}`;
      for (let part = 0; part < parts; part++) await storage.put(`${key2}-part-${part}`, bytes2.slice(part * CHUNK, (part + 1) * CHUNK));
      await storage.put(key2, { name, size: bytes2.byteLength, parts, capturedAt, receivedAt: (/* @__PURE__ */ new Date()).toISOString(), compositionId });
    }
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  if (ingest || request.method !== "GET") return json(405, "METHOD_NOT_ALLOWED");
  const [status, manifest] = await Promise.all([
    storage.get("status"),
    storage.get("program-hls-manifest")
  ]);
  if (!programEligible(status, true) || !status || !manifest || !compositionMatches(status.body, manifest.compositionId) || !fresh(manifest.receivedAt, 5e3) || !fresh(manifest.capturedAt, 5e3)) return json(404, "PROGRAM_MEDIA_NOT_CURRENT");
  const generation = status.body.engine === "obs" ? status.body.program?.generation : void 0;
  if (generation && (manifest.names.some((segment) => !segment.startsWith(`program-${generation}-`)) || name !== "index.m3u8" && !name.startsWith(`program-${generation}-`))) return json(404, "PROGRAM_GENERATION_NOT_CURRENT");
  const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Producer-Frame-At": manifest.capturedAt, ...manifest.compositionId ? { "X-Producer-Composition": manifest.compositionId } : {} };
  if (name === "index.m3u8") {
    const text = manifest.text.split("\n").map((line) => NAME.test(line.trim()) ? `${PREFIX}${line.trim()}` : line).join("\n");
    return new Response(text, { headers: { ...headers, "Content-Type": "application/vnd.apple.mpegurl" } });
  }
  if (![...manifest.names, ...manifest.previousNames].includes(name)) return json(404, "MEDIA_NOT_IN_CURRENT_WINDOW");
  const key = `program-hls-slot-${slot(name)}`;
  const entry = await storage.get(key);
  const aligned = entry?.compositionId === manifest.compositionId || status.body.engine !== "obs" && entry?.compositionId === void 0;
  if (entry?.name !== name || !aligned || !fresh(entry.capturedAt, 15e3) || !fresh(entry.receivedAt, 15e3)) return json(404, "MEDIA_SEGMENT_EXPIRED");
  const bytes = new Uint8Array(entry.size);
  for (let part = 0; part < entry.parts; part++) {
    const chunk = await storage.get(`${key}-part-${part}`);
    if (!chunk || chunk.byteLength !== Math.min(CHUNK, entry.size - part * CHUNK)) return json(404, "MEDIA_SEGMENT_INCOMPLETE");
    bytes.set(new Uint8Array(chunk), part * CHUNK);
  }
  return new Response(bytes, { headers: { ...headers, "Content-Type": "video/mp2t" } });
}
__name(handleProgramMedia, "handleProgramMedia");

// src/obs-command-policy.ts
var OBS_SCENES = ["NICK - LIVE CAMERA + STORM OVERLAY", "NICK - STANDBY"];
var OBS_ACTIONS = /* @__PURE__ */ new Map([
  ["obs.scene.set", ["scene", "set"]],
  ["obs.audio.set", ["audio", "set"]],
  ["obs.overlay.visibility", ["overlay", "visibility"]],
  ["obs.recording.start", ["recording", "start"]],
  ["obs.recording.stop", ["recording", "stop"]]
]);
var record = /* @__PURE__ */ __name((value) => Boolean(value && typeof value === "object" && !Array.isArray(value)), "record");
function validObsPayload(action, payload) {
  if (!record(payload)) return false;
  const keys = Object.keys(payload);
  if (action === "obs.scene.set") return keys.length === 1 && typeof payload.sceneName === "string" && OBS_SCENES.includes(payload.sceneName);
  if (action === "obs.overlay.visibility") return keys.length === 1 && typeof payload.enabled === "boolean";
  if (action === "obs.audio.set") return keys.length > 0 && keys.every((key) => ["muted", "volumeDb"].includes(key)) && (!keys.includes("muted") || typeof payload.muted === "boolean") && (!keys.includes("volumeDb") || typeof payload.volumeDb === "number" && Number.isFinite(payload.volumeDb) && payload.volumeDb >= -60 && payload.volumeDb <= 0);
  return ["obs.recording.start", "obs.recording.stop"].includes(action) && keys.length === 0;
}
__name(validObsPayload, "validObsPayload");
function obsActionAdvertised(action, status) {
  const mapping = OBS_ACTIONS.get(action);
  if (!mapping || status.engine !== "obs" || !record(status.capabilities) || !record(status.capabilities.actions)) return false;
  const actions = status.capabilities.actions[mapping[0]];
  return Array.isArray(actions) && actions.includes(mapping[1]);
}
__name(obsActionAdvertised, "obsActionAdvertised");

// src/producer-bridge.ts
var STATUS_KEY = "status";
var CAPABILITIES_KEY = "capabilities";
var FRAME_KEY = "program-frame";
var COMMANDS_KEY = "commands";
var CONTROL_LEASE_KEY = "producer-control-lease";
var BROADCAST_KEY = "facebook-managed-broadcast";
var BROADCAST_OPERATIONS_KEY = "facebook-broadcast-operations";
var FACEBOOK_OAUTH_SESSIONS_KEY = "facebook-oauth-sessions";
var FACEBOOK_CREDENTIAL_KEY = "facebook-page-credential";
var FACEBOOK_COMMENTS_KEY = "facebook-reply-targets";
var FACEBOOK_REPLIES_KEY = "facebook-reply-requests";
var MAX_COMMANDS = 100;
var MAX_JSON_BYTES = 64 * 1024;
var MAX_FRAME_BYTES = 2 * 1024 * 1024;
var COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var ACTIONS = /* @__PURE__ */ new Set([
  "preview.start",
  "preview.stop",
  "facebook.output.start",
  "facebook.output.stop",
  "archive.camera.start",
  "archive.camera.stop",
  "lowerThird.set",
  "lowerThird.hide",
  ...OBS_ACTIONS.keys()
]);
function json2(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
__name(json2, "json");
async function jsonBody(request, limit = MAX_JSON_BYTES) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > limit) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
__name(jsonBody, "jsonBody");
function bridgeState(document) {
  return document && Date.now() - Date.parse(document.receivedAt) <= 1e4 ? "ONLINE" : "OFFLINE";
}
__name(bridgeState, "bridgeState");
async function handleProducerStateRequest(request, storage) {
  const url = new URL(request.url);
  const path = url.pathname;
  const media = await handleProgramMedia(request, storage);
  if (media) return media;
  if (path === "/api/chase/v1/facebook/internal/broadcast") {
    const broadcast = await storage.get(BROADCAST_KEY) ?? null;
    const operations = await storage.get(BROADCAST_OPERATIONS_KEY) ?? [];
    const active = operations.find((item) => item.state === "pending" || item.state === "unknown");
    if (request.method === "GET") {
      const latest = active ?? operations.at(-1);
      return json2(200, { broadcast, operation: latest ? { requestId: latest.requestId, action: latest.action, state: latest.state } : null });
    }
    if (request.method !== "POST") return json2(405, { error: "METHOD_NOT_ALLOWED" });
    const body = await jsonBody(request, 16 * 1024);
    if (!body) return json2(400, { error: "INVALID_BROADCAST_STATE" });
    if (body.operation === "refresh-reserve") {
      const after = await storage.get("facebook-broadcast-refresh-after") ?? 0;
      if (after > Date.now()) return json2(200, { deferred: true });
      await storage.put("facebook-broadcast-refresh-after", Date.now() + 3e4);
      return json2(202, { accepted: true });
    }
    if (body.operation === "observed") {
      const next = body.broadcast;
      if (!next || !broadcast || next.id !== broadcast.id || typeof next.status !== "string") return json2(409, { error: "BROADCAST_CHANGED" });
      await storage.put(BROADCAST_KEY, { ...broadcast, status: next.status, observedAt: next.observedAt });
      if (active?.state === "unknown" && (active.action === "prepare" && next.status === "UNPUBLISHED" || active.action === "publish" && next.status === "LIVE" || active.action === "end" && ["LIVE_STOPPED", "PROCESSING", "VOD", "ENDED"].includes(next.status))) {
        active.state = "succeeded";
        await storage.put(BROADCAST_OPERATIONS_KEY, operations);
      }
      return json2(202, { accepted: true });
    }
    if (body.operation === "reserve") {
      if (typeof body.requestId !== "string" || !COMMAND_ID.test(body.requestId) || typeof body.userId !== "string" || typeof body.digest !== "string" || !["prepare", "publish", "end"].includes(String(body.action))) return json2(400, { error: "INVALID_BROADCAST_OPERATION" });
      const prior = operations.find((item) => item.requestId === body.requestId);
      if (prior) return prior.userId === body.userId && prior.digest === body.digest ? json2(409, { error: "BROADCAST_ALREADY_ATTEMPTED", state: prior.state }) : json2(409, { error: "REQUEST_ID_CONFLICT" });
      if (active) return json2(409, { error: "BROADCAST_OPERATION_UNRESOLVED", state: active.state });
      if ((broadcast?.id ?? null) !== body.expectedId) return json2(409, { error: "BROADCAST_CHANGED" });
      const terminal = broadcast && ["LIVE_STOPPED", "PROCESSING", "VOD", "ENDED", "SCHEDULED_CANCELED"].includes(broadcast.status);
      if (body.action === "prepare" && broadcast && !terminal) return json2(409, { error: "BROADCAST_ALREADY_PREPARED" });
      if (body.action !== "prepare" && (!broadcast || terminal)) return json2(409, { error: "NO_ACTIVE_MANAGED_BROADCAST" });
      if (body.action === "publish" && broadcast?.status !== "UNPUBLISHED") return json2(409, { error: "BROADCAST_NOT_UNPUBLISHED" });
      operations.push({ requestId: body.requestId, action: String(body.action), userId: body.userId, digest: body.digest, state: "pending", createdAt: Date.now() });
      await storage.put(BROADCAST_OPERATIONS_KEY, operations.slice(-200));
      return json2(202, { accepted: true });
    }
    if (body.operation === "result") {
      const operation = operations.find((item) => item.requestId === body.requestId && item.state === "pending");
      if (!operation || !["succeeded", "failed", "unknown"].includes(String(body.state))) return json2(409, { error: "BROADCAST_OPERATION_CHANGED" });
      const next = body.broadcast;
      if (next) {
        if (!/^\d{5,30}$/.test(next.id) || !/^\d{5,30}$/.test(next.pageId) || typeof next.destination?.ciphertext !== "string" || typeof next.destination?.iv !== "string") return json2(400, { error: "INVALID_ENCRYPTED_BROADCAST" });
        await storage.put(BROADCAST_KEY, next);
      }
      operation.state = String(body.state);
      if (typeof body.code === "number") operation.code = body.code;
      if (typeof body.subcode === "number") operation.subcode = body.subcode;
      await storage.put(BROADCAST_OPERATIONS_KEY, operations);
      return json2(202, { accepted: true });
    }
    return json2(400, { error: "INVALID_BROADCAST_OPERATION" });
  }
  if (path === "/api/chase/v1/facebook/internal/comment-cache" && request.method === "POST") {
    const body = await jsonBody(request);
    const cached = await storage.get("facebook-comments-cache");
    if (body?.operation === "reserve") {
      if (cached && cached.nextFetchAt > Date.now()) return json2(200, { payload: cached.payload ?? { state: "reconnecting", comments: [], pollAfterMs: 15e3, cursor: "", page: { live: false, label: "Storm Chaser Nick Mounce" } } });
      await storage.put("facebook-comments-cache", { ...cached, nextFetchAt: Date.now() + 1e4 });
      return json2(202, { fetch: true });
    }
    if (body?.operation === "save" && body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
      const payload = body.payload;
      const page = payload.page;
      const delay = payload.state === "rate_limited" ? 10 * 6e4 : payload.state !== "ok" || !page?.live ? 6e4 : 3e4;
      payload.pollAfterMs = Math.max(Number(payload.pollAfterMs) || 0, delay);
      await storage.put("facebook-comments-cache", { nextFetchAt: Date.now() + delay, payload });
      return json2(202, { accepted: true });
    }
    return json2(400, { error: "INVALID_CACHE_OPERATION" });
  }
  if (path === "/api/chase/v1/facebook/internal/targets" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body || typeof body.pageId !== "string" || typeof body.liveId !== "string" || !Array.isArray(body.ids)) return json2(400, { error: "INVALID_TARGETS" });
    const now = Date.now();
    const prior = (await storage.get(FACEBOOK_COMMENTS_KEY) ?? []).filter((item) => now - item.observedAt < 2 * 60 * 6e4);
    const targets = new Map(prior.map((item) => [item.id, item]));
    for (const id of body.ids.slice(0, 100)) if (typeof id === "string" && /^[0-9_]{5,100}$/.test(id)) targets.set(id, { id, pageId: body.pageId, liveId: body.liveId, observedAt: now });
    await storage.put(FACEBOOK_COMMENTS_KEY, [...targets.values()].slice(-500));
    return json2(202, { accepted: true });
  }
  if (path === "/api/chase/v1/facebook/internal/reply" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    if (!body || typeof body.requestId !== "string" || !COMMAND_ID.test(body.requestId) || typeof body.userId !== "string" || typeof body.digest !== "string") return json2(400, { error: "INVALID_REPLY_REQUEST" });
    const now = Date.now();
    const requests = (await storage.get(FACEBOOK_REPLIES_KEY) ?? []).filter((item) => now - item.createdAt < 24 * 60 * 6e4);
    const existing = requests.find((item) => item.requestId === body.requestId && item.userId === body.userId);
    if (existing) return existing.digest === body.digest ? json2(200, existing) : json2(409, { error: "REPLY_REQUEST_CONFLICT" });
    const targets = await storage.get(FACEBOOK_COMMENTS_KEY) ?? [];
    const target = targets.find((item) => item.id === body.commentId && item.pageId === body.pageId && item.liveId === body.liveId && now - item.observedAt < 2 * 60 * 6e4);
    if (!target) return json2(409, { error: "COMMENT_NOT_IN_CURRENT_FEED" });
    if (requests.some((item) => item.userId === body.userId && now - item.createdAt < 3e3)) return json2(429, { error: "REPLY_RATE_LIMITED" });
    const entry = { requestId: body.requestId, userId: body.userId, digest: body.digest, state: "pending", createdAt: now };
    requests.push(entry);
    await storage.put(FACEBOOK_REPLIES_KEY, requests.slice(-1e3));
    return json2(202, entry);
  }
  if (path === "/api/chase/v1/facebook/internal/reply-result" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    const requests = await storage.get(FACEBOOK_REPLIES_KEY) ?? [];
    const entry = requests.find((item) => item.requestId === body?.requestId && item.userId === body?.userId);
    if (!entry || !["sent", "failed", "unknown"].includes(String(body?.state))) return json2(400, { error: "INVALID_REPLY_RESULT" });
    entry.state = String(body.state);
    if (typeof body?.replyId === "string") entry.replyId = body.replyId;
    await storage.put(FACEBOOK_REPLIES_KEY, requests);
    return json2(202, { accepted: true });
  }
  if (path === "/api/chase/v1/facebook/internal/session" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    const ticket = typeof body?.ticket === "string" ? body.ticket : "";
    const userId = typeof body?.userId === "string" ? body.userId : "";
    const createdAt = typeof body?.createdAt === "string" ? body.createdAt : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket) || !/^[0-9a-f-]{36}$/i.test(userId) || !Number.isFinite(Date.parse(createdAt))) {
      return json2(400, { error: "INVALID_OAUTH_SESSION" });
    }
    const now = Date.now();
    const sessions = (await storage.get(FACEBOOK_OAUTH_SESSIONS_KEY) ?? []).filter((item) => now - Date.parse(item.createdAt) <= 15 * 6e4 && !item.usedAt);
    sessions.push({ ticket, userId, createdAt });
    await storage.put(FACEBOOK_OAUTH_SESSIONS_KEY, sessions.slice(-20));
    return json2(202, { accepted: true });
  }
  if (path === "/api/chase/v1/facebook/internal/session" && request.method === "GET") {
    const ticket = url.searchParams.get("ticket") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return json2(400, { error: "INVALID_OAUTH_SESSION" });
    const sessions = await storage.get(FACEBOOK_OAUTH_SESSIONS_KEY) ?? [];
    const session = sessions.find((item) => item.ticket === ticket && !item.usedAt && Date.now() - Date.parse(item.createdAt) <= 15 * 6e4);
    return session ? json2(200, session) : json2(404, { error: "OAUTH_SESSION_NOT_FOUND" });
  }
  if (path === "/api/chase/v1/facebook/internal/credential" && request.method === "POST") {
    const body = await jsonBody(request, 16 * 1024);
    const credential = body?.credential;
    const ticket = typeof body?.ticket === "string" ? body.ticket : "";
    if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(ticket) || typeof credential.pageId !== "string" || !/^\d{5,30}$/.test(credential.pageId) || typeof credential.label !== "string" || credential.label.length < 1 || credential.label.length > 120 || typeof credential.ciphertext !== "string" || !/^[A-Za-z0-9_-]{20,12000}$/.test(credential.ciphertext) || typeof credential.iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(credential.iv) || typeof credential.connectedAt !== "string" || !Number.isFinite(Date.parse(credential.connectedAt)) || typeof credential.connectedBy !== "string" || !/^[0-9a-f-]{36}$/i.test(credential.connectedBy)) {
      return json2(400, { error: "INVALID_FACEBOOK_CREDENTIAL" });
    }
    const sessions = await storage.get(FACEBOOK_OAUTH_SESSIONS_KEY) ?? [];
    const session = sessions.find((item) => item.ticket === ticket && !item.usedAt && Date.now() - Date.parse(item.createdAt) <= 15 * 6e4);
    if (!session || session.userId !== credential.connectedBy) return json2(404, { error: "OAUTH_SESSION_NOT_FOUND" });
    await storage.put(FACEBOOK_CREDENTIAL_KEY, credential);
    session.usedAt = (/* @__PURE__ */ new Date()).toISOString();
    await storage.put(FACEBOOK_OAUTH_SESSIONS_KEY, sessions);
    return json2(202, { accepted: true });
  }
  if (path === "/api/chase/v1/facebook/internal/credential" && request.method === "GET") {
    const credential = await storage.get(FACEBOOK_CREDENTIAL_KEY);
    return credential ? json2(200, credential) : json2(404, { error: "FACEBOOK_CREDENTIAL_NOT_FOUND" });
  }
  if (path === "/api/producer/v1/workstation/status" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body) return json2(400, { error: "INVALID_STATUS" });
    const value = { receivedAt: (/* @__PURE__ */ new Date()).toISOString(), body };
    await storage.put(STATUS_KEY, value);
    return json2(202, { accepted: true });
  }
  if (path === "/api/producer/v1/workstation/capabilities" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body) return json2(400, { error: "INVALID_CAPABILITIES" });
    await storage.put(CAPABILITIES_KEY, { receivedAt: (/* @__PURE__ */ new Date()).toISOString(), body });
    return json2(202, { accepted: true });
  }
  if (path === "/api/producer/v1/workstation/preview/program.jpg" && request.method === "POST") {
    const header = request.headers.get("X-Producer-Composition");
    if (header !== null && !COMPOSITION_ID.test(header)) return json2(400, { error: "INVALID_COMPOSITION_ID" });
    const compositionId = header ?? void 0;
    const status = await storage.get(STATUS_KEY);
    if (status?.body.engine === "obs" && (!programEligible(status) || !compositionMatches(status.body, compositionId))) return json2(409, { error: "PROGRAM_COMPOSITION_NOT_CURRENT" });
    const size = Number(request.headers.get("Content-Length") || 0);
    if (size > MAX_FRAME_BYTES || request.headers.get("Content-Type") !== "image/jpeg") return json2(413, { error: "INVALID_FRAME" });
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_FRAME_BYTES) return json2(413, { error: "INVALID_FRAME" });
    await storage.put(FRAME_KEY, { receivedAt: (/* @__PURE__ */ new Date()).toISOString(), frameAt: request.headers.get("X-Producer-Frame-At") || (/* @__PURE__ */ new Date()).toISOString(), bytes, compositionId });
    return json2(202, { accepted: true });
  }
  if (path === "/api/producer/v1/status" && request.method === "GET") {
    const value = await storage.get(STATUS_KEY);
    const lease = await storage.get(CONTROL_LEASE_KEY);
    const producer = value?.body ?? null;
    return json2(200, {
      bridge: bridgeState(value),
      observedAt: value?.receivedAt ?? null,
      producer,
      // Compatibility alias consumed by the OPS Producer workspace.
      status: producer,
      controlLease: lease && lease.expiresAt > Date.now() ? lease : null
    });
  }
  if (path === "/api/producer/v1/control-lease" && ["POST", "DELETE"].includes(request.method)) {
    const userId = request.headers.get("X-Producer-UserId");
    if (!userId) return json2(403, { error: "PRODUCER_CONTROL_FORBIDDEN" });
    const current = await storage.get(CONTROL_LEASE_KEY);
    if (current && current.expiresAt > Date.now() && current.userId !== userId) return json2(409, { error: "CONTROL_HELD", operator: current.operator, expiresAt: current.expiresAt });
    const lease = { userId, operator: request.headers.get("X-Producer-Operator") || "Producer", expiresAt: request.method === "DELETE" ? 0 : Date.now() + 3e4 };
    await storage.put(CONTROL_LEASE_KEY, lease);
    return json2(200, { lease: lease.expiresAt ? lease : null });
  }
  if (path === "/api/producer/v1/capabilities" && request.method === "GET") {
    const value = await storage.get(CAPABILITIES_KEY);
    return json2(200, { bridge: bridgeState(value), observedAt: value?.receivedAt ?? null, capabilities: value?.body ?? null });
  }
  if (path === "/api/producer/v1/preview/program.jpg" && request.method === "GET") {
    const [status, frame] = await Promise.all([storage.get(STATUS_KEY), storage.get(FRAME_KEY)]);
    const current = frame && mediaFresh(frame.receivedAt, 5e3) && mediaFresh(frame.frameAt, 5e3);
    if (!programEligible(status) || !status || !current || !frame || !compositionMatches(status.body, frame.compositionId)) return json2(404, { error: "PREVIEW_NOT_CURRENT" });
    return new Response(frame.bytes, { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Producer-Frame-At": frame.frameAt, "X-Content-Type-Options": "nosniff", ...frame.compositionId ? { "X-Producer-Composition": frame.compositionId } : {} } });
  }
  if (path === "/api/producer/v1/commands" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    const commandId = body?.commandId;
    const action = body?.action;
    const expected = body?.expectedStateRevision;
    if (typeof commandId !== "string" || !COMMAND_ID.test(commandId) || typeof action !== "string" || !ACTIONS.has(action) || !Number.isSafeInteger(expected)) return json2(400, { error: "INVALID_COMMAND" });
    if (action === "lowerThird.set" && (typeof body?.payload?.text !== "string" || String((body?.payload).text).length > 120)) return json2(400, { error: "INVALID_PAYLOAD" });
    if (OBS_ACTIONS.has(action) && !validObsPayload(action, body?.payload)) return json2(400, { error: "INVALID_OBS_PAYLOAD" });
    const workstationStatus = await storage.get(STATUS_KEY);
    if (OBS_ACTIONS.has(action)) {
      if (!request.headers.get("X-Producer-UserId")) return json2(403, { error: "PRODUCER_CONTROL_FORBIDDEN" });
      if (bridgeState(workstationStatus) !== "ONLINE" || !workstationStatus || !obsActionAdvertised(action, workstationStatus.body)) return json2(409, { error: "OBS_ACTION_UNAVAILABLE" });
    }
    if (workstationStatus?.body.engine === "obs" && ["facebook.output.start", "archive.camera.start", "archive.camera.stop", "lowerThird.set", "lowerThird.hide"].includes(action)) return json2(409, { error: "OBS_ACTION_UNAVAILABLE" });
    const commands = await storage.get(COMMANDS_KEY) ?? [];
    const prior = commands.find((item) => item.commandId === commandId);
    if (prior) return prior.action === action && JSON.stringify(prior.payload ?? {}) === JSON.stringify(body?.payload ?? {}) ? json2(200, prior) : json2(409, { error: "COMMAND_ID_CONFLICT" });
    const actorId = request.headers.get("X-Producer-UserId");
    const emergencyStop = action === "facebook.output.stop" || action === "preview.stop" || action === "archive.camera.stop" || action === "obs.recording.stop";
    if (actorId && !emergencyStop) {
      const lease = await storage.get(CONTROL_LEASE_KEY);
      if (!lease || lease.expiresAt <= Date.now() || lease.userId !== actorId) return json2(409, { error: "CONTROL_LEASE_REQUIRED" });
      const status = await storage.get(STATUS_KEY);
      if (bridgeState(status) !== "ONLINE") return json2(409, { error: "BRIDGE_OFFLINE" });
      if (action !== "preview.start" && status?.body.stateRevision !== expected) return json2(409, { error: "STATE_CHANGED" });
      if (action === "facebook.output.start") {
        const current = status.body;
        const managed = await storage.get(BROADCAST_KEY);
        const operations = await storage.get(BROADCAST_OPERATIONS_KEY) ?? [];
        if (operations.some((item) => item.action === "prepare" && ["pending", "unknown"].includes(item.state))) return json2(409, { error: "FACEBOOK_PREPARE_UNRESOLVED" });
        if (managed && (!["UNPUBLISHED", "PUBLISH_REQUESTED", "LIVE"].includes(managed.status) || body?.payload?.videoId !== managed.id || current.broadcast?.managedVideoId !== managed.id)) return json2(409, { error: "MANAGED_DESTINATION_NOT_READY" });
        const previews = current.previews;
        const audio = current.audio;
        const metrics = current.metrics;
        if (body?.confirmed !== true || current.source_state !== "SOURCE_LIVE" || previews?.program?.state !== "ACTIVE" || !metrics?.last_video_timestamp || !Number.isFinite(Date.parse(metrics.last_video_timestamp)) || Date.now() - Date.parse(metrics.last_video_timestamp) > 5e3 || audio?.process !== "RUNNING" || !audio.available || audio.silence || audio.clipping || !audio.lastAudioAt || !Number.isFinite(Date.parse(audio.lastAudioAt)) || Date.now() - Date.parse(audio.lastAudioAt) > 5e3) return json2(409, { error: "SOURCE_OR_AUDIO_NOT_READY" });
      }
    }
    const command = { commandId, action, expectedStateRevision: expected, ...body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? { payload: body.payload } : {}, operator: request.headers.get("X-Producer-Operator") || "unknown", createdAt: (/* @__PURE__ */ new Date()).toISOString(), state: "queued" };
    commands.push(command);
    await storage.put(COMMANDS_KEY, commands.slice(-MAX_COMMANDS));
    return json2(202, command);
  }
  if (path === "/api/producer/v1/workstation/commands" && request.method === "GET") {
    const commands = await storage.get(COMMANDS_KEY) ?? [];
    for (const command of commands) if (command.state === "queued" && Date.now() - Date.parse(command.createdAt) > 15e3) {
      command.state = "timed_out";
      command.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    await storage.put(COMMANDS_KEY, commands);
    return json2(200, { commands: commands.filter((item) => item.state === "queued").slice(0, 20) });
  }
  if (path === "/api/producer/v1/workstation/ack" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    if (typeof body?.commandId !== "string" || !COMMAND_ID.test(body.commandId) || !["succeeded", "failed", "timed_out"].includes(String(body.state))) return json2(400, { error: "INVALID_ACK" });
    const commands = await storage.get(COMMANDS_KEY) ?? [];
    const command = commands.find((item) => item.commandId === body.commandId);
    if (!command) return json2(404, { error: "COMMAND_NOT_FOUND" });
    command.state = body.state;
    command.result = body.result;
    command.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    await storage.put(COMMANDS_KEY, commands);
    return json2(200, command);
  }
  const commandMatch = /^\/api\/producer\/v1\/commands\/([0-9a-f-]+)$/.exec(path);
  if (commandMatch && request.method === "GET") {
    const commands = await storage.get(COMMANDS_KEY) ?? [];
    const command = commands.find((item) => item.commandId === commandMatch[1]);
    return command ? json2(200, command) : json2(404, { error: "COMMAND_NOT_FOUND" });
  }
  return json2(404, { error: "NOT_FOUND" });
}
__name(handleProducerStateRequest, "handleProducerStateRequest");
var ProducerBridge = class {
  constructor(state) {
    this.state = state;
  }
  state;
  static {
    __name(this, "ProducerBridge");
  }
  fetch(request) {
    return this.state.blockConcurrencyWhile(() => handleProducerStateRequest(request, this.state.storage));
  }
};

// src/facebook-lifecycle.ts
var INTERNAL = "/api/chase/v1/facebook/internal/broadcast";
var GRAPH = "https://graph.facebook.com/v26.0";
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validManagedDestination(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "rtmps:" && url.hostname === "live-api-s.facebook.com" && (!url.port || url.port === "443") && /^\/rtmp\/[A-Za-z0-9_-]{10,2048}$/.test(url.pathname) && !url.username && !url.password && !url.hash && !url.search;
  } catch {
    return false;
  }
}
__name(validManagedDestination, "validManagedDestination");
var json3 = /* @__PURE__ */ __name((status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }), "json");
var publicBroadcast = /* @__PURE__ */ __name((value) => value ? { id: value.id, pageId: value.pageId, title: value.title, description: value.description, status: value.status, createdAt: value.createdAt, observedAt: value.observedAt, facebookProducerUrl: `https://www.facebook.com/live/producer/${value.id}` } : null, "publicBroadcast");
async function handleFacebookLifecycle(request, userId, controlAllowed, workstation, deps) {
  const path = new URL(request.url).pathname;
  const [stateResponse, credential] = await Promise.all([deps.broker(INTERNAL), deps.credential()]);
  if (!stateResponse.ok) return json3(503, { error: "BROADCAST_SERVICE_UPDATING" });
  const state = await stateResponse.json();
  const permission = credential?.permissions?.includes("pages_manage_posts") === true;
  const enabled = deps.enabled && permission && Boolean(credential);
  const broadcast = state.broadcast;
  if (workstation) {
    if (path === "/api/producer/v1/workstation/facebook-health" && request.method === "GET") {
      if (!credential) return json3(200, { state: "not_connected", publishingPermissionVerified: false });
      try {
        const response = await deps.fetch(`${GRAPH}/${credential.pageId}/live_videos?broadcast_status=%5B%22LIVE%22%5D&fields=id`, { headers: { Authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(5e3) });
        const result = await response.json();
        const code2 = result.error?.code;
        return json3(200, { state: response.ok ? "healthy" : [4, 17, 32, 613].includes(code2 ?? 0) ? "rate_limited" : "unavailable", code: code2, httpStatus: response.status, publishingPermissionVerified: permission });
      } catch (error) {
        return json3(200, { state: "unavailable", failureKind: error instanceof Error ? error.name : "Error", publishingPermissionVerified: permission });
      }
    }
    if (path !== "/api/producer/v1/workstation/facebook-destination" || request.method !== "GET") return json3(404, { error: "NOT_FOUND" });
    if (!enabled || !broadcast || !["UNPUBLISHED", "PUBLISH_REQUESTED", "LIVE"].includes(broadcast.status)) return json3(200, { destination: null });
    const destination = await deps.decrypt(broadcast.destination);
    return validManagedDestination(destination) ? json3(200, { destination, videoId: broadcast.id }) : json3(503, { error: "DESTINATION_UNAVAILABLE" });
  }
  if (path === "/api/producer/v1/facebook" && request.method === "GET") return json3(200, { enabled, permission, canManage: enabled && controlAllowed, broadcast: publicBroadcast(broadcast), operation: state.operation ?? null });
  const action = path.split("/").pop();
  if (request.method !== "POST" || !["prepare", "publish", "end", "refresh"].includes(action || "")) return json3(405, { error: "METHOD_NOT_ALLOWED" });
  if (!controlAllowed || !userId) return json3(403, { error: "PRODUCER_CONTROL_FORBIDDEN" });
  if (!enabled || !credential) return json3(409, { error: !permission ? "FACEBOOK_PUBLISH_PERMISSION_REQUIRED" : "FACEBOOK_LIFECYCLE_DISABLED" });
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 8192) return json3(413, { error: "REQUEST_TOO_LARGE" });
    body = JSON.parse(text);
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
  } catch {
    return json3(400, { error: "INVALID_BROADCAST_REQUEST" });
  }
  if (action !== "refresh" && (body.confirmed !== true || typeof body.requestId !== "string" || !UUID.test(body.requestId))) return json3(400, { error: "CONFIRMATION_REQUIRED" });
  if (action !== "prepare" && (!broadcast || body.videoId !== broadcast.id)) return json3(409, { error: "BROADCAST_CHANGED" });
  if (broadcast && broadcast.pageId !== credential.pageId) return json3(409, { error: "PAGE_CHANGED" });
  const statusResponse = await deps.broker("/api/producer/v1/status");
  const bridge = await statusResponse.json();
  if (["prepare", "publish"].includes(action) && (bridge.bridge !== "ONLINE" || bridge.controlLease?.userId !== userId || bridge.controlLease.expiresAt <= Date.now())) return json3(409, { error: "LIVE_CONTROL_LEASE_REQUIRED" });
  if (action === "prepare") {
    const output = bridge.status?.broadcast;
    if (output?.requested || output?.state !== "OFF") return json3(409, { error: "STOP_ENCODER_BEFORE_PREPARING" });
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 254 || typeof body.description !== "string" || body.description.length > 2e3) return json3(400, { error: "INVALID_POST_DETAILS" });
  }
  if (action === "publish") {
    const current = bridge.status;
    const output = current?.broadcast;
    const audio = current?.audio;
    const metrics = current?.metrics;
    const fresh2 = /* @__PURE__ */ __name((at) => Boolean(at && Number.isFinite(Date.parse(at)) && Date.now() - Date.parse(at) < 5e3), "fresh");
    if (body.programConfirmed !== true || output?.managedVideoId !== broadcast.id || output.state !== "SENDING" || !fresh2(output.lastSuccessAt) || current?.source_state !== "SOURCE_LIVE" || !fresh2(metrics?.last_video_timestamp) || audio?.process !== "RUNNING" || !audio.available || audio.silence || audio.clipping || !fresh2(audio.lastAudioAt)) return json3(409, { error: "PROGRAM_NOT_READY_OR_NOT_CONFIRMED" });
  }
  const callGraph = /* @__PURE__ */ __name(async (node, method, params) => {
    const query = new URLSearchParams(params);
    const response = await deps.fetch(`${GRAPH}/${node}${method === "GET" ? `?${query}` : ""}`, { method, headers: { Authorization: `Bearer ${credential.token}`, "Content-Type": "application/x-www-form-urlencoded" }, ...method === "GET" ? {} : { body: query }, signal: AbortSignal.timeout(1e4) });
    const result = await response.json();
    if (!response.ok) {
      const error = result.error;
      const failure = new Error("META_REJECTED");
      failure.code = error?.code;
      failure.subcode = error?.error_subcode;
      failure.definite = response.status >= 400 && response.status < 500;
      throw failure;
    }
    return result;
  }, "callGraph");
  if (action === "refresh") {
    const reserve = await deps.broker(INTERNAL, { method: "POST", body: JSON.stringify({ operation: "refresh-reserve" }) });
    if (reserve.status !== 202) return json3(200, { broadcast: publicBroadcast(broadcast), refreshDeferred: true });
    try {
      const observed = await callGraph(broadcast.id, "GET", { fields: "id,status" });
      if (typeof observed.status !== "string") throw new Error();
      const next2 = { ...broadcast, status: observed.status, observedAt: (/* @__PURE__ */ new Date()).toISOString() };
      const saved2 = await deps.broker(INTERNAL, { method: "POST", body: JSON.stringify({ operation: "observed", broadcast: next2 }) });
      if (!saved2.ok) return json3(503, { error: "STATE_SAVE_FAILED" });
      return json3(200, { broadcast: publicBroadcast(next2) });
    } catch (error) {
      return json3(502, { error: "META_STATUS_UNAVAILABLE", code: error.code });
    }
  }
  const digest = JSON.stringify([action, body.videoId ?? null, body.title ?? null, body.description ?? null]);
  const reserved = await deps.broker(INTERNAL, { method: "POST", body: JSON.stringify({ operation: "reserve", requestId: body.requestId, action, userId, digest, expectedId: broadcast?.id ?? null }) });
  if (reserved.status !== 202) return reserved;
  let next;
  let resultState = "unknown";
  let code;
  let subcode;
  try {
    const result = await callGraph(action === "prepare" ? `${credential.pageId}/live_videos` : broadcast.id, "POST", action === "prepare" ? { status: "UNPUBLISHED", title: body.title.trim(), description: body.description, stream_type: "REGULAR" } : action === "publish" ? { status: "LIVE_NOW" } : { end_live_video: "true" });
    if (action === "prepare") {
      if (typeof result.id !== "string" || !/^\d{5,30}$/.test(result.id) || !validManagedDestination(result.secure_stream_url)) throw new Error("INVALID_META_DESTINATION");
      next = { id: result.id, pageId: credential.pageId, title: body.title.trim(), description: body.description, createdAt: (/* @__PURE__ */ new Date()).toISOString(), status: "PREPARE_UNCONFIRMED", observedAt: (/* @__PURE__ */ new Date()).toISOString(), destination: await deps.encrypt(result.secure_stream_url) };
      const verified = await callGraph(result.id, "GET", { fields: "id,status" });
      if (verified.status !== "UNPUBLISHED") throw new Error("UNPUBLISHED_STATE_NOT_VERIFIED");
      next.status = "UNPUBLISHED";
    } else {
      if (result.success !== true && result.id !== broadcast.id) throw new Error("META_OUTCOME_UNKNOWN");
      next = { ...broadcast, status: action === "end" ? "END_REQUESTED" : "PUBLISH_REQUESTED", observedAt: (/* @__PURE__ */ new Date()).toISOString() };
    }
    resultState = "succeeded";
  } catch (error) {
    const failure = error;
    if (failure.definite && !next) resultState = "failed";
    code = failure.code;
    subcode = failure.subcode;
  }
  const saved = await deps.broker(INTERNAL, { method: "POST", body: JSON.stringify({ operation: "result", requestId: body.requestId, state: resultState, broadcast: next, code, subcode }) });
  if (!saved.ok) return json3(503, { error: "OUTCOME_SAVE_UNCONFIRMED", state: "unknown" });
  return json3(resultState === "succeeded" ? 200 : 502, { state: resultState, broadcast: publicBroadcast(next ?? broadcast), code, subcode, error: resultState === "succeeded" ? void 0 : resultState === "unknown" ? "META_OUTCOME_UNKNOWN_DO_NOT_RETRY" : "META_REJECTED" });
}
__name(handleFacebookLifecycle, "handleFacebookLifecycle");

// src/index.ts
var CORE_ORIGIN = "http://127.0.0.1:8000";
var MAX_BODY_BYTES = 16 * 1024;
var CONFIG_PATH = "/api/chase/v1/config";
var TELEMETRY_PATH = "/api/chase/v1/telemetry";
var COMMENTS_PATH = "/api/chase/v1/comments";
var FACEBOOK_CONNECT_SESSION_PATH = "/api/chase/v1/facebook/connect-session";
var FACEBOOK_CONNECT_PATH = "/api/chase/v1/facebook/connect";
var FACEBOOK_CALLBACK_PATH = "/api/chase/v1/facebook/callback";
var FACEBOOK_CONNECTION_STATUS_PATH = "/api/chase/v1/facebook/status";
var FACEBOOK_REPLY_PATH = "/api/chase/v1/facebook/reply";
var FACEBOOK_REDIRECT_URI = "https://ops.codeblackwx.com/api/chase/v1/facebook/callback";
var FACEBOOK_GRAPH_ORIGIN = "https://graph.facebook.com/v26.0";
var COMMENT_POLL_AFTER_MS = 2e3;
var MAX_COMMENT_CURSOR_LENGTH = 32;
var FACEBOOK_PAGE_LABEL = "Storm Chaser Nick Mounce";
var PUBLIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
var PUBLIC_UNIT_ID = "cbwx-unit-tessa";
var PUBLIC_FRESH_MS = 15e3;
function json4(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
__name(json4, "json");
function publicJson(status, body) {
  const response = json4(status, body);
  for (const [name, value] of Object.entries(PUBLIC_CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}
__name(publicJson, "publicJson");
function legacyAuthorized(request, expected) {
  if (!expected) return false;
  const header = request.headers.get("Authorization") || "";
  return header === `Bearer ${expected}`;
}
__name(legacyAuthorized, "legacyAuthorized");
function commentResponse(state, cursor, comments = [], pollAfterMs = COMMENT_POLL_AFTER_MS, facebookLive = false) {
  return json4(200, {
    state,
    cursor,
    pollAfterMs,
    comments,
    page: { label: FACEBOOK_PAGE_LABEL, live: facebookLive }
  });
}
__name(commentResponse, "commentResponse");
function validFacebookPageId(value) {
  return typeof value === "string" && /^\d{5,30}$/.test(value);
}
__name(validFacebookPageId, "validFacebookPageId");
function validCommentCursor(value) {
  return value !== null && /^\d{10,13}$/.test(value) && value.length <= MAX_COMMENT_CURSOR_LENGTH;
}
__name(validCommentCursor, "validCommentCursor");
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64Url, "base64Url");
function fromBase64Url(value) {
  const padding = (4 - value.length % 4) % 4;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padding);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
__name(fromBase64Url, "fromBase64Url");
async function facebookEncryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`codeblack-facebook-page-token-v1:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
__name(facebookEncryptionKey, "facebookEncryptionKey");
async function encryptFacebookToken(token, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await facebookEncryptionKey(secret), new TextEncoder().encode(token));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}
__name(encryptFacebookToken, "encryptFacebookToken");
async function decryptFacebookToken(credential, secret) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(credential.iv) },
      await facebookEncryptionKey(secret),
      fromBase64Url(credential.ciphertext)
    );
    const token = new TextDecoder().decode(decrypted);
    return token.length >= 40 && token.length <= 2e3 ? token : null;
  } catch {
    return null;
  }
}
__name(decryptFacebookToken, "decryptFacebookToken");
async function facebookBroker(env, path, init) {
  if (!env.PRODUCER_BRIDGE) return json4(503, { error: "FACEBOOK_CONNECTOR_UNAVAILABLE" });
  const id = env.PRODUCER_BRIDGE.idFromName("native-producer");
  return env.PRODUCER_BRIDGE.get(id).fetch(new Request(`https://facebook-broker.internal${path}`, init));
}
__name(facebookBroker, "facebookBroker");
async function storedFacebookCredential(env) {
  if (!env.PRODUCER_BRIDGE || !env.FACEBOOK_TOKEN_KEK) return null;
  try {
    const response = await facebookBroker(env, "/api/chase/v1/facebook/internal/credential");
    if (!response.ok) return null;
    const credential = await response.json();
    if (!validFacebookPageId(credential.pageId) || credential.pageId !== env.FACEBOOK_PAGE_ID) return null;
    const token = await decryptFacebookToken(credential, env.FACEBOOK_TOKEN_KEK);
    return token ? { ...credential, token } : null;
  } catch {
    return null;
  }
}
__name(storedFacebookCredential, "storedFacebookCredential");
function normalizeGraphComments(data, previousCursor) {
  if (!data || typeof data !== "object" || !Array.isArray(data.data)) {
    return { cursor: previousCursor, comments: [] };
  }
  let latest = Number(previousCursor) || 0;
  const comments = [];
  for (const item of data.data) {
    if (!item || typeof item.id !== "string" || typeof item.message !== "string" || typeof item.created_time !== "string") continue;
    const createdAtMs = Date.parse(item.created_time);
    if (!Number.isFinite(createdAtMs)) continue;
    latest = Math.max(latest, Math.floor(createdAtMs / 1e3));
    comments.push({
      id: item.id,
      author: typeof item.from?.name === "string" && item.from.name.trim() ? item.from.name.slice(0, 120) : "Viewer",
      message: item.message.slice(0, 2e3),
      createdAt: new Date(createdAtMs).toISOString()
    });
  }
  return { cursor: latest > 0 ? String(latest) : previousCursor, comments };
}
__name(normalizeGraphComments, "normalizeGraphComments");
async function forwardFacebookComments(url, env) {
  const stored = await storedFacebookCredential(env);
  const pageToken = stored?.token ?? env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!validFacebookPageId(env.FACEBOOK_PAGE_ID) || !pageToken) {
    return commentResponse("not_configured", "");
  }
  const requestedCursor = url.searchParams.get("after");
  const cursor = validCommentCursor(requestedCursor) ? requestedCursor : "";
  const pageUrl = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${env.FACEBOOK_PAGE_ID}/live_videos`);
  pageUrl.searchParams.set("broadcast_status", '["LIVE"]');
  pageUrl.searchParams.set("fields", "id");
  let liveResponse;
  try {
    liveResponse = await fetch(pageUrl, { headers: { Authorization: `Bearer ${pageToken}` } });
  } catch {
    return commentResponse("reconnecting", cursor);
  }
  if (liveResponse.status === 429) return new Response(JSON.stringify({ state: "rate_limited", cursor, pollAfterMs: 1e4, comments: [] }), { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "10" } });
  if (!liveResponse.ok) return graphFailureResponse(liveResponse, cursor);
  let liveData;
  try {
    liveData = await liveResponse.json();
  } catch {
    return commentResponse("reconnecting", cursor);
  }
  const liveId = Array.isArray(liveData.data) ? liveData.data.find((video) => typeof video?.id === "string")?.id : void 0;
  if (typeof liveId !== "string") return commentResponse("ok", cursor);
  const commentsUrl = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${liveId}/comments`);
  commentsUrl.searchParams.set("filter", "stream");
  commentsUrl.searchParams.set("order", "reverse_chronological");
  commentsUrl.searchParams.set("live_filter", "filter_low_quality");
  commentsUrl.searchParams.set("fields", "id,from{name},message,created_time");
  commentsUrl.searchParams.set("limit", "100");
  if (cursor) commentsUrl.searchParams.set("since", cursor);
  let commentsResponse;
  try {
    commentsResponse = await fetch(commentsUrl, { headers: { Authorization: `Bearer ${pageToken}` } });
  } catch {
    return commentResponse("reconnecting", cursor);
  }
  if (commentsResponse.status === 429) return new Response(JSON.stringify({ state: "rate_limited", cursor, pollAfterMs: 1e4, comments: [] }), { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "10" } });
  if (!commentsResponse.ok) return graphFailureResponse(commentsResponse, cursor);
  try {
    const normalized = normalizeGraphComments(await commentsResponse.json(), cursor);
    if (stored?.permissions?.includes("pages_manage_engagement") && env.PRODUCER_BRIDGE) {
      await facebookBroker(env, "/api/chase/v1/facebook/internal/targets", {
        method: "POST",
        body: JSON.stringify({ pageId: env.FACEBOOK_PAGE_ID, liveId, ids: normalized.comments.map((item) => item.id) })
      });
    }
    return commentResponse("ok", normalized.cursor, normalized.comments, COMMENT_POLL_AFTER_MS, true);
  } catch {
    return commentResponse("reconnecting", cursor);
  }
}
__name(forwardFacebookComments, "forwardFacebookComments");
async function sharedFacebookComments(url, env) {
  if (!env.PRODUCER_BRIDGE) return forwardFacebookComments(url, env);
  const reserve = await facebookBroker(env, "/api/chase/v1/facebook/internal/comment-cache", { method: "POST", body: JSON.stringify({ operation: "reserve" }) });
  if (reserve.status === 200) {
    const cached = await reserve.json();
    return json4(200, cached.payload);
  }
  if (reserve.status !== 202) return commentResponse("reconnecting", "", [], 6e4);
  const sharedUrl = new URL(url);
  sharedUrl.searchParams.delete("after");
  const response = await forwardFacebookComments(sharedUrl, env);
  const payload = await response.json();
  const page = payload.page;
  payload.pollAfterMs = payload.state === "rate_limited" ? 6e5 : payload.state !== "ok" || !page?.live ? 6e4 : 3e4;
  await facebookBroker(env, "/api/chase/v1/facebook/internal/comment-cache", { method: "POST", body: JSON.stringify({ operation: "save", payload }) });
  return json4(200, payload);
}
__name(sharedFacebookComments, "sharedFacebookComments");
async function graphFailureResponse(response, cursor) {
  try {
    const result = await response.json();
    const code = result.error?.code;
    if (code === 190 || code === 102 || code === 10 || code === 200) return commentResponse("auth_failed", cursor, [], 6e4);
    if (code === 4 || code === 17 || code === 32 || code === 613) return commentResponse("rate_limited", cursor, [], 6e4);
  } catch {
  }
  return commentResponse(response.status === 401 || response.status === 403 ? "auth_failed" : "reconnecting", cursor, [], 5e3);
}
__name(graphFailureResponse, "graphFailureResponse");
function displayNameFromProfileEmail(email) {
  if (typeof email !== "string") return void 0;
  const local = email.trim().split("@", 1)[0] ?? "";
  const name = local.split(/[._+\-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ").slice(0, 24);
  return name || void 0;
}
__name(displayNameFromProfileEmail, "displayNameFromProfileEmail");
function displayNameFromProfile(value) {
  if (typeof value !== "string") return void 0;
  const name = value.trim().slice(0, 24);
  return /^[\p{L}\p{N} .'-]{1,24}$/u.test(name) ? name : void 0;
}
__name(displayNameFromProfile, "displayNameFromProfile");
function vehicleNameFromProfile(value) {
  if (typeof value !== "string") return void 0;
  const vehicle = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(vehicle) ? vehicle : void 0;
}
__name(vehicleNameFromProfile, "vehicleNameFromProfile");
async function authorizeCaller(request, env, allowLegacy = true) {
  if (allowLegacy && legacyAuthorized(request, env.CHASE_TOKEN)) return {};
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_PUBLISHABLE_KEY };
  try {
    const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers });
    if (!userResponse.ok) return null;
    const user = await userResponse.json();
    if (!user.id) return null;
    const profileResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/profiles?select=active,email,operator_name,vehicle_id&user_id=eq.${encodeURIComponent(user.id)}`,
      { headers }
    );
    if (!profileResponse.ok) return null;
    const profiles = await profileResponse.json();
    const profile = Array.isArray(profiles) ? profiles.find((candidate) => candidate.active === true) : void 0;
    return profile ? {
      userId: user.id,
      operatorName: displayNameFromProfile(profile.operator_name) ?? displayNameFromProfileEmail(profile.email),
      vehicleName: vehicleNameFromProfile(profile.vehicle_id)
    } : null;
  } catch {
    return null;
  }
}
__name(authorizeCaller, "authorizeCaller");
function facebookConnectorAllowed(caller, env) {
  if (!caller.userId) return false;
  return (env.FACEBOOK_CONNECTOR_USER_IDS || "").split(",").map((id) => id.trim()).filter(Boolean).includes(caller.userId);
}
__name(facebookConnectorAllowed, "facebookConnectorAllowed");
function facebookConnectorConfigured(env) {
  return Boolean(
    env.PRODUCER_BRIDGE && validFacebookPageId(env.FACEBOOK_PAGE_ID) && /^\d{5,30}$/.test(env.FACEBOOK_APP_ID || "") && (env.FACEBOOK_APP_SECRET?.length ?? 0) >= 20 && (env.FACEBOOK_TOKEN_KEK?.length ?? 0) >= 40
  );
}
__name(facebookConnectorConfigured, "facebookConnectorConfigured");
function facebookReplyAllowed(caller, env) {
  return env.FACEBOOK_REPLIES_ENABLED === "true" && Boolean(caller.userId && (env.PRODUCER_OPERATOR_IDS || "").split(",").map((id) => id.trim()).includes(caller.userId));
}
__name(facebookReplyAllowed, "facebookReplyAllowed");
async function handleFacebookReply(request, env) {
  if (request.method !== "POST") return json4(405, { error: "METHOD_NOT_ALLOWED" });
  const caller = await authorizeCaller(request, env, false);
  if (!caller) return json4(401, { error: "AUTH_REQUIRED" });
  if (!facebookReplyAllowed(caller, env)) return json4(403, { error: "FACEBOOK_REPLY_FORBIDDEN" });
  if (Number(request.headers.get("Content-Length") || 0) > 8192) return json4(413, { error: "REPLY_TOO_LARGE" });
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 8192) return json4(413, { error: "REPLY_TOO_LARGE" });
    body = JSON.parse(text);
  } catch {
    return json4(400, { error: "INVALID_REPLY" });
  }
  if (!body || body.confirmed !== true || typeof body.commentId !== "string" || !/^[0-9_]{5,100}$/.test(body.commentId) || typeof body.message !== "string" || !body.message.trim() || body.message.length > 2e3 || typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) return json4(400, { error: "INVALID_REPLY" });
  const credential = await storedFacebookCredential(env);
  if (!credential?.permissions?.includes("pages_manage_engagement")) return json4(409, { error: "FACEBOOK_REPLY_PERMISSION_REQUIRED" });
  let liveId;
  try {
    const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/${credential.pageId}/live_videos?broadcast_status=%5B%22LIVE%22%5D&fields=id`, {
      headers: { Authorization: `Bearer ${credential.token}` },
      signal: AbortSignal.timeout(1e4)
    });
    if (!response.ok) return json4(409, { error: "FACEBOOK_LIVE_UNAVAILABLE" });
    const videos = await response.json();
    liveId = videos.data?.[0]?.id;
  } catch {
    return json4(503, { error: "FACEBOOK_UNAVAILABLE" });
  }
  if (!liveId) return json4(409, { error: "NO_ACTIVE_FACEBOOK_LIVE" });
  const digest = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([body.commentId, body.message.trim()])))));
  const reserved = await facebookBroker(env, "/api/chase/v1/facebook/internal/reply", {
    method: "POST",
    body: JSON.stringify({ requestId: body.requestId, userId: caller.userId, digest, commentId: body.commentId, pageId: credential.pageId, liveId })
  });
  if (reserved.status !== 202) {
    if (reserved.status !== 200) return reserved;
    const prior = await reserved.json();
    return json4(prior.state === "sent" ? 200 : 409, { state: prior.state, replyId: prior.replyId, error: prior.state === "sent" ? void 0 : "REPLY_ALREADY_ATTEMPTED" });
  }
  let state = "unknown";
  let replyId;
  try {
    const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/${body.commentId}/comments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: body.message.trim() }),
      signal: AbortSignal.timeout(1e4)
    });
    if (response.ok) {
      const result = await response.json();
      if (typeof result.id === "string") {
        state = "sent";
        replyId = result.id;
      }
    } else if (response.status >= 400 && response.status < 500) state = "failed";
  } catch {
  }
  await facebookBroker(env, "/api/chase/v1/facebook/internal/reply-result", {
    method: "POST",
    body: JSON.stringify({ requestId: body.requestId, userId: caller.userId, state, replyId })
  });
  return json4(state === "sent" ? 200 : 502, { state, replyId, error: state === "sent" ? void 0 : state === "unknown" ? "REPLY_OUTCOME_UNKNOWN" : "FACEBOOK_REPLY_REJECTED" });
}
__name(handleFacebookReply, "handleFacebookReply");
function facebookResultPage(title, message, success = false) {
  const escapeHtml = /* @__PURE__ */ __name((value) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]), "escapeHtml");
  const color = success ? "#36e37d" : "#ff5d67";
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${safeTitle}</title><style>body{margin:0;background:#07090c;color:#fff;font-family:system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{max-width:34rem;margin:1.5rem;padding:2rem;border:1px solid #28303a;border-radius:14px;background:#0f1319}h1{margin:0 0 1rem;color:${color};font-size:1.4rem}p{line-height:1.5;color:#c8d0da}</style></head><body><main class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p><p>You may close this window and return to Chase.</p></main></body></html>`;
  const resultHtml = html.replace("You may close this window and return to Chase.", 'Return to Chase, or <a style="color:#8bc9ef" href="/producer">open the Producer console</a>.');
  return new Response(resultHtml, { status: success ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
__name(facebookResultPage, "facebookResultPage");
async function graphTokenExchange(parameters) {
  try {
    const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(parameters)
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.access_token === "string" && body.access_token.length >= 40 ? body.access_token : null;
  } catch {
    return null;
  }
}
__name(graphTokenExchange, "graphTokenExchange");
async function handleFacebookConnector(request, url, env) {
  if (url.pathname === FACEBOOK_CONNECT_SESSION_PATH) {
    if (request.method !== "POST") return json4(405, { error: "METHOD_NOT_ALLOWED" });
    const caller = await authorizeCaller(request, env, false);
    if (!caller) return json4(401, { error: "AUTH_REQUIRED" });
    if (!facebookConnectorAllowed(caller, env)) return json4(403, { error: "FACEBOOK_CONNECT_FORBIDDEN" });
    if (!facebookConnectorConfigured(env)) return json4(503, { error: "FACEBOOK_CONNECT_NOT_CONFIGURED" });
    const ticket = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const accepted = await facebookBroker(env, "/api/chase/v1/facebook/internal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, userId: caller.userId, createdAt: (/* @__PURE__ */ new Date()).toISOString() })
    });
    if (!accepted.ok) return json4(503, { error: "FACEBOOK_CONNECT_UNAVAILABLE" });
    return json4(200, { connectUrl: `https://ops.codeblackwx.com${FACEBOOK_CONNECT_PATH}?ticket=${ticket}`, expiresInSeconds: 600 });
  }
  if (url.pathname === FACEBOOK_CONNECTION_STATUS_PATH) {
    if (request.method !== "GET") return json4(405, { error: "METHOD_NOT_ALLOWED" });
    const caller = await authorizeCaller(request, env, false);
    if (!caller) return json4(401, { error: "AUTH_REQUIRED" });
    const credential = await storedFacebookCredential(env);
    let health;
    if (credential && url.searchParams.get("diagnostics") === "1" && facebookConnectorAllowed(caller, env)) {
      try {
        const probe = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/${credential.pageId}/live_videos?broadcast_status=%5B%22LIVE%22%5D&fields=id`, { headers: { Authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(8e3) });
        const result = await probe.json();
        health = { state: probe.ok ? "healthy" : "auth_failed", httpStatus: probe.status, code: result.error?.code, subcode: result.error?.error_subcode };
      } catch {
        health = { state: "unavailable" };
      }
    }
    return json4(200, credential ? { state: "connected", page: { id: credential.pageId, label: credential.label }, connectedAt: credential.connectedAt, health, canConnect: facebookConnectorAllowed(caller, env), canReply: facebookReplyAllowed(caller, env) && credential.permissions?.includes("pages_manage_engagement") === true } : { state: facebookConnectorConfigured(env) ? "not_connected" : "not_configured", page: { label: FACEBOOK_PAGE_LABEL }, canConnect: facebookConnectorAllowed(caller, env), canReply: false });
  }
  if (url.pathname === FACEBOOK_CONNECT_PATH) {
    if (request.method !== "GET") return json4(405, { error: "METHOD_NOT_ALLOWED" });
    if (!facebookConnectorConfigured(env)) return facebookResultPage("Facebook connection unavailable", "Code Black has not finished configuring this connection.");
    const ticket = url.searchParams.get("ticket") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return facebookResultPage("Link expired", "Open Facebook connection from Chase again.");
    const session = await facebookBroker(env, `/api/chase/v1/facebook/internal/session?ticket=${encodeURIComponent(ticket)}`);
    if (!session.ok) return facebookResultPage("Link expired", "Open Facebook connection from Chase again.");
    const authorize = new URL("https://www.facebook.com/v26.0/dialog/oauth");
    authorize.searchParams.set("client_id", env.FACEBOOK_APP_ID);
    authorize.searchParams.set("redirect_uri", FACEBOOK_REDIRECT_URI);
    authorize.searchParams.set("state", ticket);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", `pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_engagement${env.FACEBOOK_LIFECYCLE_ENABLED === "true" ? ",pages_manage_posts" : ""}`);
    authorize.searchParams.set("auth_type", "rerequest");
    return Response.redirect(authorize.toString(), 302);
  }
  if (url.pathname === FACEBOOK_CALLBACK_PATH) {
    if (request.method !== "GET") return json4(405, { error: "METHOD_NOT_ALLOWED" });
    if (!facebookConnectorConfigured(env)) return facebookResultPage("Facebook connection unavailable", "Code Black has not finished configuring this connection.");
    if (url.searchParams.has("error")) return facebookResultPage("Facebook connection cancelled", "No Page access was changed.");
    const ticket = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket) || code.length < 20 || code.length > 2e3) return facebookResultPage("Link expired", "Open Facebook connection from Chase again.");
    const sessionResponse = await facebookBroker(env, `/api/chase/v1/facebook/internal/session?ticket=${encodeURIComponent(ticket)}`);
    if (!sessionResponse.ok) return facebookResultPage("Link expired", "Open Facebook connection from Chase again.");
    const session = await sessionResponse.json();
    if (!session.userId || !(env.FACEBOOK_CONNECTOR_USER_IDS || "").split(",").map((id) => id.trim()).includes(session.userId)) {
      return facebookResultPage("Connection rejected", "This OPS account is not permitted to connect the Page.");
    }
    const shortToken = await graphTokenExchange({ client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, redirect_uri: FACEBOOK_REDIRECT_URI, code });
    if (!shortToken) return facebookResultPage("Facebook connection failed", "Meta did not accept the authorization response. Please try again from Chase.");
    const longToken = await graphTokenExchange({ grant_type: "fb_exchange_token", client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, fb_exchange_token: shortToken });
    if (!longToken) return facebookResultPage("Facebook connection failed", "Meta did not issue a long-lived authorization. Please try again from Chase.");
    let permissions = [];
    try {
      const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/me/permissions`, { headers: { Authorization: `Bearer ${longToken}` } });
      const result = await response.json();
      if (!response.ok) return facebookResultPage("Permission check unavailable", `Meta rejected its permission check${typeof result.error?.code === "number" ? ` (code ${result.error.code})` : ""}. The existing Page credential was preserved. Try reconnecting after Meta is available again.`);
      if (response.ok && Array.isArray(result.data)) permissions = result.data.filter((item) => item.status === "granted" && typeof item.permission === "string").map((item) => item.permission);
    } catch {
      return facebookResultPage("Permission check failed", "Facebook permissions could not be verified. Reconnect from Producer.");
    }
    const missing = ["pages_show_list", "pages_read_engagement", "pages_read_user_content"].filter((item) => !permissions.includes(item));
    if (missing.length) return facebookResultPage("Facebook permissions missing", `Meta did not grant: ${missing.join(", ")}. The existing Page credential was preserved. Reconnect from Producer and grant the missing access.`);
    let accounts;
    try {
      const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts?fields=id,name,access_token&limit=100`, { headers: { Authorization: `Bearer ${longToken}`, Accept: "application/json" } });
      if (!response.ok) return facebookResultPage("Page access unavailable", "Facebook did not return a Page that this account manages.");
      accounts = await response.json();
    } catch {
      return facebookResultPage("Facebook connection failed", "The Page list could not be verified. Please try again from Chase.");
    }
    const page = Array.isArray(accounts.data) ? accounts.data.find((item) => item.id === env.FACEBOOK_PAGE_ID) : void 0;
    if (!page || typeof page.access_token !== "string" || page.access_token.length < 40) {
      return facebookResultPage("Nick's Page was not authorized", `Select ${FACEBOOK_PAGE_LABEL} when Facebook asks which Page to connect.`);
    }
    const encrypted = await encryptFacebookToken(page.access_token, env.FACEBOOK_TOKEN_KEK);
    const credential = {
      pageId: env.FACEBOOK_PAGE_ID,
      label: typeof page.name === "string" && page.name.trim() ? page.name.slice(0, 120) : FACEBOOK_PAGE_LABEL,
      ...encrypted,
      connectedAt: (/* @__PURE__ */ new Date()).toISOString(),
      connectedBy: session.userId,
      permissions
    };
    const stored = await facebookBroker(env, "/api/chase/v1/facebook/internal/credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, credential })
    });
    return stored.ok ? facebookResultPage("Facebook comments connected", `${credential.label} is connected. ${permissions.includes("pages_manage_engagement") ? "Authorized producers can reply as the Page." : "Replies require reconnecting with comment-management permission."}`, true) : facebookResultPage("Facebook connection failed", "The credential could not be stored. Please try again from Chase.");
  }
  return json4(404, { error: "NOT_FOUND" });
}
__name(handleFacebookConnector, "handleFacebookConnector");
function producerWorkstationAuthorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  return Boolean(env.PRODUCER_BRIDGE_TOKEN && header === `Bearer ${env.PRODUCER_BRIDGE_TOKEN}`);
}
__name(producerWorkstationAuthorized, "producerWorkstationAuthorized");
function producerOperatorAllowed(caller, env) {
  if (env.PRODUCER_CONTROLS_ENABLED !== "true" || !caller.userId) return false;
  return (env.PRODUCER_OPERATOR_IDS || "").split(",").map((id) => id.trim()).filter(Boolean).includes(caller.userId);
}
__name(producerOperatorAllowed, "producerOperatorAllowed");
async function handleProducerRoute(request, url, env) {
  if (!env.PRODUCER_BRIDGE) return json4(503, { error: "BRIDGE_NOT_CONFIGURED" });
  const workstation = url.pathname.startsWith("/api/producer/v1/workstation/");
  let operator = "workstation";
  let userId;
  let controlAllowed = false;
  if (workstation) {
    if (!producerWorkstationAuthorized(request, env)) return json4(401, { error: "AUTH_REQUIRED" });
  } else {
    const caller = await authorizeCaller(request, env, false);
    if (!caller) return json4(401, { error: "AUTH_REQUIRED" });
    operator = caller.operatorName || caller.userId || "operator";
    userId = caller.userId;
    controlAllowed = producerOperatorAllowed(caller, env);
    if (!["GET", "HEAD"].includes(request.method) && !controlAllowed) return json4(403, { error: "PRODUCER_CONTROL_FORBIDDEN" });
  }
  const id = env.PRODUCER_BRIDGE.idFromName("native-producer");
  const stub = env.PRODUCER_BRIDGE.get(id);
  if (url.pathname === "/api/producer/v1/facebook" || url.pathname.startsWith("/api/producer/v1/facebook/") || ["/api/producer/v1/workstation/facebook-destination", "/api/producer/v1/workstation/facebook-health"].includes(url.pathname)) {
    if (request.method === "POST" && ["/api/producer/v1/facebook/prepare", "/api/producer/v1/facebook/publish", "/api/producer/v1/facebook/end"].includes(url.pathname)) {
      const stateResponse = await stub.fetch(new Request("https://producer.internal/api/producer/v1/status"));
      if (!stateResponse.ok) return json4(503, { error: "BRIDGE_STATUS_UNAVAILABLE" });
      const stateDocument = await stateResponse.json();
      if ((stateDocument.status ?? stateDocument.producer)?.engine === "obs") return json4(409, { error: "OBS_FACEBOOK_NOT_QUALIFIED" });
    }
    return handleFacebookLifecycle(request, userId, controlAllowed, workstation, {
      credential: /* @__PURE__ */ __name(() => storedFacebookCredential(env), "credential"),
      broker: /* @__PURE__ */ __name((path, init) => facebookBroker(env, path, init), "broker"),
      encrypt: /* @__PURE__ */ __name((value) => encryptFacebookToken(value, env.FACEBOOK_TOKEN_KEK), "encrypt"),
      decrypt: /* @__PURE__ */ __name((value) => decryptFacebookToken(value, env.FACEBOOK_TOKEN_KEK), "decrypt"),
      fetch: /* @__PURE__ */ __name((input, init) => fetch(input, init), "fetch"),
      enabled: env.FACEBOOK_LIFECYCLE_ENABLED === "true"
    });
  }
  const headers = new Headers();
  for (const name of ["Content-Type", "Content-Length", "X-Producer-Frame-At", "X-Producer-Composition"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("X-Producer-Operator", operator);
  if (userId) headers.set("X-Producer-UserId", userId);
  const response = await stub.fetch(new Request(request.url, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? void 0 : request.body }));
  if (!workstation && request.method === "GET" && url.pathname === "/api/producer/v1/status" && response.ok) {
    const document = await response.json();
    if (!("status" in document) && "producer" in document) document.status = document.producer;
    document.controlAccess = { allowed: controlAllowed, userId };
    return json4(response.status, document);
  }
  return response;
}
__name(handleProducerRoute, "handleProducerRoute");
async function authorized(request, env) {
  return await authorizeCaller(request, env) !== null;
}
__name(authorized, "authorized");
async function forwardPost(request, env) {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_BODY_BYTES) return json4(413, { error: "PAYLOAD_TOO_LARGE" });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return json4(413, { error: "PAYLOAD_TOO_LARGE" });
  return env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/chase/location`, {
    method: "POST",
    headers: {
      Authorization: request.headers.get("Authorization") ?? "",
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body
  });
}
__name(forwardPost, "forwardPost");
async function forwardConfig(env, caller) {
  if (!env.CHASE_TOKEN) return json4(503, { error: "CORE_UNAVAILABLE" });
  const response = await env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/chase/v1/config`, {
    headers: { Authorization: `Bearer ${env.CHASE_TOKEN}`, Accept: "application/json" }
  });
  if (response.ok && (caller.operatorName || caller.vehicleName)) {
    try {
      const document = await response.json();
      const profile = document.profile && typeof document.profile === "object" && !Array.isArray(document.profile) ? document.profile : {};
      document.profile = {
        ...profile,
        ...caller.operatorName ? { operator_name: caller.operatorName } : {},
        ...caller.vehicleName ? { vehicle_name: caller.vehicleName } : {}
      };
      return json4(response.status, document);
    } catch {
      return json4(502, { error: "CONFIG_INVALID" });
    }
  }
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store"
    }
  });
}
__name(forwardConfig, "forwardConfig");
async function forwardTelemetry(request, env) {
  if (!env.CHASE_TOKEN) return json4(503, { error: "CORE_UNAVAILABLE" });
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_BODY_BYTES) return json4(413, { error: "PAYLOAD_TOO_LARGE" });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return json4(413, { error: "PAYLOAD_TOO_LARGE" });
  return env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/chase/location`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CHASE_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      // This header is added only by the fixed public gateway route; callers cannot select it.
      "X-CodeBlack-Chase-Source": "public-v1"
    },
    body
  });
}
__name(forwardTelemetry, "forwardTelemetry");
async function forwardLatest(url, request, env) {
  const target = new URL("/api/chase/location/latest", CORE_ORIGIN);
  const unitId = url.searchParams.get("unit_id");
  if (unitId) target.searchParams.set("unit_id", unitId.slice(0, 80));
  return env.CORE_VPC.fetch(target, {
    headers: {
      Authorization: request.headers.get("Authorization") ?? "",
      Accept: "application/json"
    }
  });
}
__name(forwardLatest, "forwardLatest");
function isFreshAge(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= PUBLIC_FRESH_MS;
}
__name(isFreshAge, "isFreshAge");
async function forwardPublicLatest(url, env) {
  if (url.searchParams.getAll("unit_id").some((id) => id !== PUBLIC_UNIT_ID)) {
    return publicJson(404, { error: "UNIT_NOT_PUBLIC" });
  }
  const target = new URL("/api/chase/location/latest", CORE_ORIGIN);
  target.searchParams.set("unit_id", PUBLIC_UNIT_ID);
  const response = await env.CORE_VPC.fetch(target, {
    headers: { Authorization: `Bearer ${env.CHASE_TOKEN}`, Accept: "application/json" }
  });
  if (!response.ok) return publicJson(502, { error: "LOCATION_UNAVAILABLE" });
  const data = await response.json();
  if (!data || data.unit_id !== PUBLIC_UNIT_ID) return publicJson(502, { error: "LOCATION_UNAVAILABLE" });
  const fresh2 = data.stale === false && isFreshAge(data.receiver_age_ms) && isFreshAge(data.fix_age_ms) && data.receiver_age_ms + data.fix_age_ms <= PUBLIC_FRESH_MS;
  const validFix = typeof data.lat === "number" && Number.isFinite(data.lat) && Math.abs(data.lat) <= 90 && typeof data.lon === "number" && Number.isFinite(data.lon) && Math.abs(data.lon) <= 180;
  const sharing = data.location_sharing === true;
  const body = {
    unit_id: PUBLIC_UNIT_ID,
    location_sharing: sharing,
    stale: !fresh2 || !validFix
  };
  if (sharing && fresh2 && validFix) {
    body.lat = Math.round(data.lat * 100) / 100;
    body.lon = Math.round(data.lon * 100) / 100;
  }
  return publicJson(200, body);
}
__name(forwardPublicLatest, "forwardPublicLatest");
var UPDATE_PATH = "/api/chase/v1/update";
var DOWNLOAD_PATH = "/api/chase/v1/download";
var RELEASE_PREFIX = "/api/chase/v1/releases/";
var ARCHIVE_PATH = "/api/chase/v1/releases/archive";
var ARCHIVE_PREFIX = `${ARCHIVE_PATH}/`;
var UPDATE_HOST = "ops.codeblackwx.com";
function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
__name(isSha256, "isSha256");
function releaseFileName(versionCode) {
  return `chase-recovery-${versionCode}.apk`;
}
__name(releaseFileName, "releaseFileName");
function publishedManifestIsSafe(data) {
  if (!data || typeof data !== "object") return false;
  const manifest = data;
  const versionCode = manifest.versionCode;
  if (manifest.schema !== "codeblack.chase.update" || manifest.schemaVersion !== "1.0.0") return false;
  if (manifest.channel !== "recovery") return false;
  if (typeof versionCode !== "number" || !Number.isInteger(versionCode) || versionCode < 1) return false;
  if (typeof manifest.versionName !== "string" || manifest.versionName.length < 1 || manifest.versionName.length > 40) return false;
  if (!isSha256(manifest.sha256) || !isSha256(manifest.signerSha256)) return false;
  if (typeof manifest.apkUrl !== "string") return false;
  if (typeof manifest.publishedAt !== "string" || Number.isNaN(Date.parse(manifest.publishedAt))) return false;
  if (typeof manifest.minimumSupportedVersionCode !== "number" || manifest.minimumSupportedVersionCode < 1 || manifest.minimumSupportedVersionCode > versionCode) return false;
  if (typeof manifest.required !== "boolean") return false;
  if (typeof manifest.releaseNotes !== "string" || manifest.releaseNotes.length > 2e3) return false;
  let url;
  try {
    url = new URL(manifest.apkUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
  if (url.hostname !== UPDATE_HOST) return false;
  if (url.pathname !== `${RELEASE_PREFIX}${releaseFileName(versionCode)}`) return false;
  return true;
}
__name(publishedManifestIsSafe, "publishedManifestIsSafe");
function releaseArchiveIsSafe(data) {
  if (!data || typeof data !== "object") return false;
  const archive = data;
  if (archive.schema !== "codeblack.chase.release-archive" || archive.schemaVersion !== "1.0.0") return false;
  if (!Array.isArray(archive.releases) || archive.releases.length > 50) return false;
  return archive.releases.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const release = entry;
    return typeof release.versionCode === "number" && Number.isInteger(release.versionCode) && release.versionCode >= 1 && release.fileName === releaseFileName(release.versionCode) && isSha256(release.sha256) && isSha256(release.signerSha256);
  });
}
__name(releaseArchiveIsSafe, "releaseArchiveIsSafe");
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
async function readAsset(env, path) {
  if (!env.ASSETS) return null;
  const response = await env.ASSETS.fetch(new Request(new URL(path, "https://assets.local")));
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}
__name(readAsset, "readAsset");
async function verifiedApkResponse(env, fileName, expectedSha256) {
  const apk = await readAsset(env, `/${fileName}`);
  if (!apk) return json4(404, { error: "NOT_FOUND" });
  const actual = await sha256Hex(apk);
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) return json4(409, { error: "CHECKSUM_MISMATCH" });
  return new Response(apk, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Cache-Control": "no-store",
      "Content-Length": String(apk.byteLength)
    }
  });
}
__name(verifiedApkResponse, "verifiedApkResponse");
async function handleUpdateRoute(request, url, env) {
  if (request.method !== "GET") return json4(405, { error: "METHOD_NOT_ALLOWED" });
  if (url.pathname === ARCHIVE_PATH || url.pathname.startsWith(ARCHIVE_PREFIX)) {
    const archiveBytes = await readAsset(env, "/release-archive.json");
    if (!archiveBytes) return json4(404, { error: "ARCHIVE_NOT_FOUND" });
    let archive;
    try {
      archive = JSON.parse(new TextDecoder().decode(archiveBytes));
    } catch {
      return json4(500, { error: "ARCHIVE_INVALID" });
    }
    if (!releaseArchiveIsSafe(archive)) return json4(500, { error: "ARCHIVE_INVALID" });
    if (url.pathname === ARCHIVE_PATH) {
      return new Response(archiveBytes, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    const fileName2 = url.pathname.slice(ARCHIVE_PREFIX.length);
    const release = archive.releases.find((entry) => entry.fileName === fileName2);
    if (!release || url.pathname !== `${ARCHIVE_PREFIX}${fileName2}`) return json4(404, { error: "NOT_FOUND" });
    return verifiedApkResponse(env, fileName2, release.sha256);
  }
  const manifestBytes = await readAsset(env, "/update.json");
  if (!manifestBytes) return json4(404, { error: "NO_UPDATE_PUBLISHED" });
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    return json4(500, { error: "MANIFEST_INVALID" });
  }
  if (!publishedManifestIsSafe(manifest)) return json4(500, { error: "MANIFEST_INVALID" });
  if (url.pathname === UPDATE_PATH) {
    return new Response(manifestBytes, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  if (url.pathname === DOWNLOAD_PATH) {
    return verifiedApkResponse(env, releaseFileName(manifest.versionCode), manifest.sha256);
  }
  const fileName = url.pathname.slice(RELEASE_PREFIX.length);
  if (fileName !== releaseFileName(manifest.versionCode) || url.pathname !== `${RELEASE_PREFIX}${fileName}`) {
    return json4(404, { error: "NOT_FOUND" });
  }
  return verifiedApkResponse(env, fileName, manifest.sha256);
}
__name(handleUpdateRoute, "handleUpdateRoute");
async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === FACEBOOK_REPLY_PATH) return handleFacebookReply(request, env);
  if (url.pathname.startsWith("/api/producer/v1/")) return handleProducerRoute(request, url, env);
  if ([FACEBOOK_CONNECT_SESSION_PATH, FACEBOOK_CONNECT_PATH, FACEBOOK_CALLBACK_PATH, FACEBOOK_CONNECTION_STATUS_PATH].includes(url.pathname)) {
    return handleFacebookConnector(request, url, env);
  }
  if (url.pathname === UPDATE_PATH || url.pathname === DOWNLOAD_PATH || url.pathname.startsWith(RELEASE_PREFIX)) {
    try {
      return await handleUpdateRoute(request, url, env);
    } catch {
      return json4(500, { error: "UPDATE_UNAVAILABLE" });
    }
  }
  if (url.pathname === COMMENTS_PATH) {
    if (request.method !== "GET") return json4(405, { error: "METHOD_NOT_ALLOWED" });
    if (!await authorized(request, env)) return json4(401, { error: "AUTH_REQUIRED" });
    return sharedFacebookComments(url, env);
  }
  if (!env.CORE_VPC) return json4(503, { error: "CORE_UNAVAILABLE" });
  if (url.pathname === "/api/chase/mesonet/ota/check" || /^\/api\/chase\/mesonet\/ota\/image\/(wind|weather|striker-weather|striker-nav)\/\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(url.pathname)) {
    if (request.method !== "GET") return json4(405, { error: "METHOD_NOT_ALLOWED" });
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json4(401, { error: "AUTH_REQUIRED" });
    const path = url.pathname.replace("/api/chase/mesonet/ota", "/api/mesonet/v1/ota");
    try {
      const upstream = await env.CORE_VPC.fetch(`${CORE_ORIGIN}${path}${url.search}`, {
        headers: { Authorization: authorization }
      });
      const headers = new Headers(upstream.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
      return json4(502, { error: "CORE_TRANSPORT_UNAVAILABLE" });
    }
  }
  if (url.pathname === "/api/chase/mesonet/ingest") {
    if (request.method !== "POST") return json4(405, { error: "METHOD_NOT_ALLOWED" });
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json4(401, { error: "AUTH_REQUIRED" });
    const length = Number(request.headers.get("Content-Length") || "0");
    if (length > 4096) return json4(413, { error: "PAYLOAD_TOO_LARGE" });
    const body = await request.arrayBuffer();
    if (body.byteLength > 4096) return json4(413, { error: "PAYLOAD_TOO_LARGE" });
    try {
      return await env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/mesonet/v1/ingest`, {
        method: "POST",
        body,
        headers: { Authorization: authorization, "Content-Type": "application/json" }
      });
    } catch {
      return json4(502, { error: "CORE_TRANSPORT_UNAVAILABLE" });
    }
  }
  if (url.pathname === "/api/chase/mesonet/public") {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
    if (request.method !== "GET") return json4(405, { error: "METHOD_NOT_ALLOWED" });
    if (!env.MESONET_READ_TOKEN) return json4(503, { error: "NOT_CONFIGURED" });
    try {
      const upstream = await env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/mesonet/v1/latest`, {
        headers: { Authorization: `Bearer ${env.MESONET_READ_TOKEN}` }
      });
      if (!upstream.ok) return json4(503, { error: "READINGS_UNAVAILABLE" });
      const state = await upstream.json();
      const wind = state.wind?.readings ?? {}, weather = state.weather?.readings ?? {};
      return new Response(JSON.stringify({
        temperature_c: weather.temperature_c ?? null,
        humidity_pct: weather.humidity_pct ?? null,
        dewpoint_c: weather.dewpoint_c ?? null,
        wind_mps: state.wind?.calibration_verified ? wind.wind_mps ?? null : null,
        wind_avg_mps: state.wind?.calibration_verified ? wind.wind_avg_mps ?? null : null,
        gust_mps: state.wind?.calibration_verified ? wind.gust_mps ?? null : null,
        wind_calibration_verified: state.wind?.calibration_verified === true,
        wind_reference: "apparent",
        generated_at: (/* @__PURE__ */ new Date()).toISOString()
      }), { headers: { ...PUBLIC_CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    } catch {
      return json4(502, { error: "CORE_TRANSPORT_UNAVAILABLE" });
    }
  }
  if (url.pathname === "/api/chase/location/public") {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
    }
    if (request.method !== "GET") return json4(405, { error: "METHOD_NOT_ALLOWED" });
    if (!env.CHASE_TOKEN) return json4(503, { error: "CORE_UNAVAILABLE" });
    try {
      return await forwardPublicLatest(url, env);
    } catch {
      return json4(502, { error: "CORE_TRANSPORT_UNAVAILABLE" });
    }
  }
  if (url.pathname === CONFIG_PATH && request.method === "GET") {
    const caller = await authorizeCaller(request, env);
    if (!caller) return json4(401, { error: "AUTH_REQUIRED" });
    try {
      return await forwardConfig(env, caller);
    } catch {
      return json4(502, { error: "CORE_UNAVAILABLE" });
    }
  }
  if (!await authorized(request, env)) return json4(401, { error: "AUTH_REQUIRED" });
  try {
    if (url.pathname === TELEMETRY_PATH && request.method === "POST") {
      return await forwardTelemetry(request, env);
    }
    if (url.pathname === "/api/chase/location" && request.method === "POST") {
      return await forwardPost(request, env);
    }
    if (url.pathname === "/api/chase/location/latest" && request.method === "GET") {
      return await forwardLatest(url, request, env);
    }
    if (url.pathname.startsWith("/api/chase/") && !["GET", "POST"].includes(request.method)) {
      return json4(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return json4(404, { error: "NOT_FOUND" });
  } catch {
    return json4(502, { error: "CORE_TRANSPORT_UNAVAILABLE" });
  }
}
__name(handleRequest, "handleRequest");
var index_default = {
  fetch: handleRequest
};
export {
  ProducerBridge,
  index_default as default,
  handleRequest
};
//# sourceMappingURL=index.js.map
