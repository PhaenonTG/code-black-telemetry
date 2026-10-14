import { handleProgramMedia } from "./program-media";
import { COMPOSITION_ID, compositionMatches, mediaFresh, programEligible } from "./media-proof";
import { OBS_ACTIONS, obsActionAdvertised, validObsPayload } from "./obs-command-policy";

const STATUS_KEY = "status";
const CAPABILITIES_KEY = "capabilities";
const FRAME_KEY = "program-frame";
const COMMANDS_KEY = "commands";
const CONTROL_LEASE_KEY = "producer-control-lease";
const BROADCAST_KEY = "facebook-managed-broadcast";
const BROADCAST_OPERATIONS_KEY = "facebook-broadcast-operations";
const FACEBOOK_OAUTH_SESSIONS_KEY = "facebook-oauth-sessions";
const FACEBOOK_CREDENTIAL_KEY = "facebook-page-credential";
const FACEBOOK_COMMENTS_KEY = "facebook-reply-targets";
const FACEBOOK_REPLIES_KEY = "facebook-reply-requests";
const MAX_COMMANDS = 100;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const COMMAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "preview.start", "preview.stop", "facebook.output.start", "facebook.output.stop",
  "archive.camera.start", "archive.camera.stop", "lowerThird.set", "lowerThird.hide",
  ...OBS_ACTIONS.keys(),
]);

export interface BridgeStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

type StoredDocument = { receivedAt: string; body: Record<string, unknown> };
type StoredFrame = { receivedAt: string; frameAt: string; bytes: ArrayBuffer; compositionId?: string };
type StoredCommand = {
  commandId: string; action: string; expectedStateRevision: number; payload?: Record<string, unknown>;
  operator: string; createdAt: string; state: "queued" | "succeeded" | "failed" | "timed_out";
  result?: unknown; completedAt?: string;
};
type ControlLease = { userId: string; operator: string; expiresAt: number };
type StoredOAuthSession = {
  ticket: string;
  userId: string;
  createdAt: string;
  usedAt?: string;
};
type StoredFacebookCredential = {
  pageId: string;
  label: string;
  ciphertext: string;
  iv: string;
  connectedAt: string;
  connectedBy: string;
  permissions?: string[];
};
type ReplyTarget = { id: string; liveId: string; pageId: string; observedAt: number };
type ReplyRequest = { requestId: string; userId: string; digest: string; state: string; createdAt: number; replyId?: string };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function jsonBody(request: Request, limit = MAX_JSON_BYTES): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > limit) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function bridgeState(document: StoredDocument | undefined): "ONLINE" | "OFFLINE" {
  return document && Date.now() - Date.parse(document.receivedAt) <= 10_000 ? "ONLINE" : "OFFLINE";
}

export async function handleProducerStateRequest(request: Request, storage: BridgeStorage): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const media = await handleProgramMedia(request, storage);
  if (media) return media;

  if (path === "/api/chase/v1/facebook/internal/broadcast") {
    type Broadcast = import("./facebook-lifecycle").ManagedBroadcast;
    type Operation = { requestId: string; action: string; userId: string; digest: string; state: string; createdAt: number; code?: number; subcode?: number };
    const broadcast = await storage.get<Broadcast>(BROADCAST_KEY) ?? null;
    const operations = await storage.get<Operation[]>(BROADCAST_OPERATIONS_KEY) ?? [];
    const active = operations.find(item => item.state === "pending" || item.state === "unknown");
    if (request.method === "GET") {
      const latest = active ?? operations.at(-1);
      return json(200, { broadcast, operation: latest ? { requestId: latest.requestId, action: latest.action, state: latest.state } : null });
    }
    if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
    const body = await jsonBody(request, 16 * 1024);
    if (!body) return json(400, { error: "INVALID_BROADCAST_STATE" });
    if (body.operation === "refresh-reserve") {
      const after = await storage.get<number>("facebook-broadcast-refresh-after") ?? 0;
      if (after > Date.now()) return json(200, { deferred: true });
      await storage.put("facebook-broadcast-refresh-after", Date.now() + 30_000);
      return json(202, { accepted: true });
    }
    if (body.operation === "observed") {
      const next = body.broadcast as Broadcast | undefined;
      if (!next || !broadcast || next.id !== broadcast.id || typeof next.status !== "string") return json(409, { error: "BROADCAST_CHANGED" });
      await storage.put(BROADCAST_KEY, { ...broadcast, status: next.status, observedAt: next.observedAt });
      if (active?.state === "unknown" && ((active.action === "prepare" && next.status === "UNPUBLISHED") || (active.action === "publish" && next.status === "LIVE") || (active.action === "end" && ["LIVE_STOPPED", "PROCESSING", "VOD", "ENDED"].includes(next.status)))) {
        active.state = "succeeded";
        await storage.put(BROADCAST_OPERATIONS_KEY, operations);
      }
      return json(202, { accepted: true });
    }
    if (body.operation === "reserve") {
      if (typeof body.requestId !== "string" || !COMMAND_ID.test(body.requestId) || typeof body.userId !== "string" || typeof body.digest !== "string" || !["prepare", "publish", "end"].includes(String(body.action))) return json(400, { error: "INVALID_BROADCAST_OPERATION" });
      const prior = operations.find(item => item.requestId === body.requestId);
      if (prior) return prior.userId === body.userId && prior.digest === body.digest ? json(409, { error: "BROADCAST_ALREADY_ATTEMPTED", state: prior.state }) : json(409, { error: "REQUEST_ID_CONFLICT" });
      if (active) return json(409, { error: "BROADCAST_OPERATION_UNRESOLVED", state: active.state });
      if ((broadcast?.id ?? null) !== body.expectedId) return json(409, { error: "BROADCAST_CHANGED" });
      const terminal = broadcast && ["LIVE_STOPPED", "PROCESSING", "VOD", "ENDED", "SCHEDULED_CANCELED"].includes(broadcast.status);
      if (body.action === "prepare" && broadcast && !terminal) return json(409, { error: "BROADCAST_ALREADY_PREPARED" });
      if (body.action !== "prepare" && (!broadcast || terminal)) return json(409, { error: "NO_ACTIVE_MANAGED_BROADCAST" });
      if (body.action === "publish" && broadcast?.status !== "UNPUBLISHED") return json(409, { error: "BROADCAST_NOT_UNPUBLISHED" });
      operations.push({ requestId: body.requestId, action: String(body.action), userId: body.userId, digest: body.digest, state: "pending", createdAt: Date.now() });
      await storage.put(BROADCAST_OPERATIONS_KEY, operations.slice(-200));
      return json(202, { accepted: true });
    }
    if (body.operation === "result") {
      const operation = operations.find(item => item.requestId === body.requestId && item.state === "pending");
      if (!operation || !["succeeded", "failed", "unknown"].includes(String(body.state))) return json(409, { error: "BROADCAST_OPERATION_CHANGED" });
      const next = body.broadcast as Broadcast | undefined;
      if (next) {
        if (!/^\d{5,30}$/.test(next.id) || !/^\d{5,30}$/.test(next.pageId) || typeof next.destination?.ciphertext !== "string" || typeof next.destination?.iv !== "string") return json(400, { error: "INVALID_ENCRYPTED_BROADCAST" });
        await storage.put(BROADCAST_KEY, next);
      }
      operation.state = String(body.state);
      if (typeof body.code === "number") operation.code = body.code;
      if (typeof body.subcode === "number") operation.subcode = body.subcode;
      await storage.put(BROADCAST_OPERATIONS_KEY, operations);
      return json(202, { accepted: true });
    }
    return json(400, { error: "INVALID_BROADCAST_OPERATION" });
  }

  if (path === "/api/chase/v1/facebook/internal/comment-cache" && request.method === "POST") {
    const body = await jsonBody(request);
    const cached = await storage.get<{ nextFetchAt: number; payload?: Record<string, unknown> }>("facebook-comments-cache");
    if (body?.operation === "reserve") {
      if (cached && cached.nextFetchAt > Date.now()) return json(200, { payload: cached.payload ?? { state: "reconnecting", comments: [], pollAfterMs: 15_000, cursor: "", page: { live: false, label: "Storm Chaser Nick Mounce" } } });
      await storage.put("facebook-comments-cache", { ...cached, nextFetchAt: Date.now() + 10_000 });
      return json(202, { fetch: true });
    }
    if (body?.operation === "save" && body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
      const payload = body.payload as Record<string, unknown>;
      const page = payload.page as { live?: boolean } | undefined;
      const delay = payload.state === "rate_limited" ? 10 * 60_000 : payload.state !== "ok" || !page?.live ? 60_000 : 30_000;
      payload.pollAfterMs = Math.max(Number(payload.pollAfterMs) || 0, delay);
      await storage.put("facebook-comments-cache", { nextFetchAt: Date.now() + delay, payload });
      return json(202, { accepted: true });
    }
    return json(400, { error: "INVALID_CACHE_OPERATION" });
  }

  if (path === "/api/chase/v1/facebook/internal/targets" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body || typeof body.pageId !== "string" || typeof body.liveId !== "string" || !Array.isArray(body.ids)) return json(400, { error: "INVALID_TARGETS" });
    const now = Date.now();
    const prior = (await storage.get<ReplyTarget[]>(FACEBOOK_COMMENTS_KEY) ?? []).filter(item => now - item.observedAt < 2 * 60 * 60_000);
    const targets = new Map(prior.map(item => [item.id, item]));
    for (const id of body.ids.slice(0, 100)) if (typeof id === "string" && /^[0-9_]{5,100}$/.test(id)) targets.set(id, { id, pageId: body.pageId, liveId: body.liveId, observedAt: now });
    await storage.put(FACEBOOK_COMMENTS_KEY, [...targets.values()].slice(-500));
    return json(202, { accepted: true });
  }
  if (path === "/api/chase/v1/facebook/internal/reply" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    if (!body || typeof body.requestId !== "string" || !COMMAND_ID.test(body.requestId) || typeof body.userId !== "string" || typeof body.digest !== "string") return json(400, { error: "INVALID_REPLY_REQUEST" });
    const now = Date.now();
    const requests = (await storage.get<ReplyRequest[]>(FACEBOOK_REPLIES_KEY) ?? []).filter(item => now - item.createdAt < 24 * 60 * 60_000);
    const existing = requests.find(item => item.requestId === body.requestId && item.userId === body.userId);
    if (existing) return existing.digest === body.digest ? json(200, existing) : json(409, { error: "REPLY_REQUEST_CONFLICT" });
    const targets = await storage.get<ReplyTarget[]>(FACEBOOK_COMMENTS_KEY) ?? [];
    const target = targets.find(item => item.id === body.commentId && item.pageId === body.pageId && item.liveId === body.liveId && now - item.observedAt < 2 * 60 * 60_000);
    if (!target) return json(409, { error: "COMMENT_NOT_IN_CURRENT_FEED" });
    if (requests.some(item => item.userId === body.userId && now - item.createdAt < 3_000)) return json(429, { error: "REPLY_RATE_LIMITED" });
    const entry: ReplyRequest = { requestId: body.requestId, userId: body.userId, digest: body.digest, state: "pending", createdAt: now };
    requests.push(entry);
    await storage.put(FACEBOOK_REPLIES_KEY, requests.slice(-1000));
    return json(202, entry);
  }
  if (path === "/api/chase/v1/facebook/internal/reply-result" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    const requests = await storage.get<ReplyRequest[]>(FACEBOOK_REPLIES_KEY) ?? [];
    const entry = requests.find(item => item.requestId === body?.requestId && item.userId === body?.userId);
    if (!entry || !["sent", "failed", "unknown"].includes(String(body?.state))) return json(400, { error: "INVALID_REPLY_RESULT" });
    entry.state = String(body!.state);
    if (typeof body?.replyId === "string") entry.replyId = body.replyId;
    await storage.put(FACEBOOK_REPLIES_KEY, requests);
    return json(202, { accepted: true });
  }

  if (path === "/api/chase/v1/facebook/internal/session" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    const ticket = typeof body?.ticket === "string" ? body.ticket : "";
    const userId = typeof body?.userId === "string" ? body.userId : "";
    const createdAt = typeof body?.createdAt === "string" ? body.createdAt : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket) || !/^[0-9a-f-]{36}$/i.test(userId) || !Number.isFinite(Date.parse(createdAt))) {
      return json(400, { error: "INVALID_OAUTH_SESSION" });
    }
    const now = Date.now();
    const sessions = (await storage.get<StoredOAuthSession[]>(FACEBOOK_OAUTH_SESSIONS_KEY) ?? [])
      .filter((item) => now - Date.parse(item.createdAt) <= 15 * 60_000 && !item.usedAt);
    sessions.push({ ticket, userId, createdAt });
    await storage.put(FACEBOOK_OAUTH_SESSIONS_KEY, sessions.slice(-20));
    return json(202, { accepted: true });
  }
  if (path === "/api/chase/v1/facebook/internal/session" && request.method === "GET") {
    const ticket = url.searchParams.get("ticket") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return json(400, { error: "INVALID_OAUTH_SESSION" });
    const sessions = await storage.get<StoredOAuthSession[]>(FACEBOOK_OAUTH_SESSIONS_KEY) ?? [];
    const session = sessions.find((item) => item.ticket === ticket && !item.usedAt && Date.now() - Date.parse(item.createdAt) <= 15 * 60_000);
    return session ? json(200, session) : json(404, { error: "OAUTH_SESSION_NOT_FOUND" });
  }
  if (path === "/api/chase/v1/facebook/internal/credential" && request.method === "POST") {
    const body = await jsonBody(request, 16 * 1024);
    const credential = body?.credential as Record<string, unknown> | undefined;
    const ticket = typeof body?.ticket === "string" ? body.ticket : "";
    if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(ticket)
      || typeof credential.pageId !== "string" || !/^\d{5,30}$/.test(credential.pageId)
      || typeof credential.label !== "string" || credential.label.length < 1 || credential.label.length > 120
      || typeof credential.ciphertext !== "string" || !/^[A-Za-z0-9_-]{20,12000}$/.test(credential.ciphertext)
      || typeof credential.iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(credential.iv)
      || typeof credential.connectedAt !== "string" || !Number.isFinite(Date.parse(credential.connectedAt))
      || typeof credential.connectedBy !== "string" || !/^[0-9a-f-]{36}$/i.test(credential.connectedBy)) {
      return json(400, { error: "INVALID_FACEBOOK_CREDENTIAL" });
    }
    const sessions = await storage.get<StoredOAuthSession[]>(FACEBOOK_OAUTH_SESSIONS_KEY) ?? [];
    const session = sessions.find((item) => item.ticket === ticket && !item.usedAt && Date.now() - Date.parse(item.createdAt) <= 15 * 60_000);
    if (!session || session.userId !== credential.connectedBy) return json(404, { error: "OAUTH_SESSION_NOT_FOUND" });
    await storage.put(FACEBOOK_CREDENTIAL_KEY, credential as unknown as StoredFacebookCredential);
    session.usedAt = new Date().toISOString();
    await storage.put(FACEBOOK_OAUTH_SESSIONS_KEY, sessions);
    return json(202, { accepted: true });
  }
  if (path === "/api/chase/v1/facebook/internal/credential" && request.method === "GET") {
    const credential = await storage.get<StoredFacebookCredential>(FACEBOOK_CREDENTIAL_KEY);
    return credential ? json(200, credential) : json(404, { error: "FACEBOOK_CREDENTIAL_NOT_FOUND" });
  }

  if (path === "/api/producer/v1/workstation/status" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body) return json(400, { error: "INVALID_STATUS" });
    const value: StoredDocument = { receivedAt: new Date().toISOString(), body };
    await storage.put(STATUS_KEY, value);
    return json(202, { accepted: true });
  }
  if (path === "/api/producer/v1/workstation/capabilities" && request.method === "POST") {
    const body = await jsonBody(request);
    if (!body) return json(400, { error: "INVALID_CAPABILITIES" });
    await storage.put(CAPABILITIES_KEY, { receivedAt: new Date().toISOString(), body } satisfies StoredDocument);
    return json(202, { accepted: true });
  }
  if (path === "/api/producer/v1/workstation/preview/program.jpg" && request.method === "POST") {
    const header = request.headers.get("X-Producer-Composition");
    if (header !== null && !COMPOSITION_ID.test(header)) return json(400, { error: "INVALID_COMPOSITION_ID" });
    const compositionId = header ?? undefined;
    const status = await storage.get<StoredDocument>(STATUS_KEY);
    if (status?.body.engine === "obs" && (!programEligible(status) || !compositionMatches(status.body, compositionId))) return json(409, { error: "PROGRAM_COMPOSITION_NOT_CURRENT" });
    const size = Number(request.headers.get("Content-Length") || 0);
    if (size > MAX_FRAME_BYTES || request.headers.get("Content-Type") !== "image/jpeg") return json(413, { error: "INVALID_FRAME" });
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_FRAME_BYTES) return json(413, { error: "INVALID_FRAME" });
    await storage.put(FRAME_KEY, { receivedAt: new Date().toISOString(), frameAt: request.headers.get("X-Producer-Frame-At") || new Date().toISOString(), bytes, compositionId } satisfies StoredFrame);
    return json(202, { accepted: true });
  }

  if (path === "/api/producer/v1/status" && request.method === "GET") {
    const value = await storage.get<StoredDocument>(STATUS_KEY);
    const lease = await storage.get<ControlLease>(CONTROL_LEASE_KEY);
    const producer = value?.body ?? null;
    return json(200, {
      bridge: bridgeState(value),
      observedAt: value?.receivedAt ?? null,
      producer,
      // Compatibility alias consumed by the OPS Producer workspace.
      status: producer,
      controlLease: lease && lease.expiresAt > Date.now() ? lease : null,
    });
  }
  if (path === "/api/producer/v1/control-lease" && ["POST", "DELETE"].includes(request.method)) {
    const userId = request.headers.get("X-Producer-UserId");
    if (!userId) return json(403, { error: "PRODUCER_CONTROL_FORBIDDEN" });
    const current = await storage.get<ControlLease>(CONTROL_LEASE_KEY);
    if (current && current.expiresAt > Date.now() && current.userId !== userId) return json(409, { error: "CONTROL_HELD", operator: current.operator, expiresAt: current.expiresAt });
    const lease = { userId, operator: request.headers.get("X-Producer-Operator") || "Producer", expiresAt: request.method === "DELETE" ? 0 : Date.now() + 30_000 };
    await storage.put(CONTROL_LEASE_KEY, lease);
    return json(200, { lease: lease.expiresAt ? lease : null });
  }
  if (path === "/api/producer/v1/capabilities" && request.method === "GET") {
    const value = await storage.get<StoredDocument>(CAPABILITIES_KEY);
    return json(200, { bridge: bridgeState(value), observedAt: value?.receivedAt ?? null, capabilities: value?.body ?? null });
  }
  if (path === "/api/producer/v1/preview/program.jpg" && request.method === "GET") {
    const [status, frame] = await Promise.all([storage.get<StoredDocument>(STATUS_KEY), storage.get<StoredFrame>(FRAME_KEY)]);
    const current = frame && mediaFresh(frame.receivedAt, 5000) && mediaFresh(frame.frameAt, 5000);
    if (!programEligible(status) || !status || !current || !frame || !compositionMatches(status.body, frame.compositionId)) return json(404, { error: "PREVIEW_NOT_CURRENT" });
    return new Response(frame.bytes, { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Producer-Frame-At": frame.frameAt, "X-Content-Type-Options": "nosniff", ...(frame.compositionId ? { "X-Producer-Composition": frame.compositionId } : {}) } });
  }

  if (path === "/api/producer/v1/commands" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    const commandId = body?.commandId;
    const action = body?.action;
    const expected = body?.expectedStateRevision;
    if (typeof commandId !== "string" || !COMMAND_ID.test(commandId) || typeof action !== "string" || !ACTIONS.has(action) || !Number.isSafeInteger(expected)) return json(400, { error: "INVALID_COMMAND" });
    if (action === "lowerThird.set" && (typeof (body?.payload as Record<string, unknown> | undefined)?.text !== "string" || String((body?.payload as Record<string, unknown>).text).length > 120)) return json(400, { error: "INVALID_PAYLOAD" });
    if (OBS_ACTIONS.has(action) && !validObsPayload(action, body?.payload)) return json(400, { error: "INVALID_OBS_PAYLOAD" });
    const workstationStatus = await storage.get<StoredDocument>(STATUS_KEY);
    if (OBS_ACTIONS.has(action)) {
      if (!request.headers.get("X-Producer-UserId")) return json(403, { error: "PRODUCER_CONTROL_FORBIDDEN" });
      if (bridgeState(workstationStatus) !== "ONLINE" || !workstationStatus || !obsActionAdvertised(action, workstationStatus.body)) return json(409, { error: "OBS_ACTION_UNAVAILABLE" });
    }
    if (workstationStatus?.body.engine === "obs" && ["facebook.output.start", "archive.camera.start", "archive.camera.stop", "lowerThird.set", "lowerThird.hide"].includes(action)) return json(409, { error: "OBS_ACTION_UNAVAILABLE" });
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
    const prior = commands.find((item) => item.commandId === commandId);
    if (prior) return prior.action === action && JSON.stringify(prior.payload ?? {}) === JSON.stringify(body?.payload ?? {}) ? json(200, prior) : json(409, { error: "COMMAND_ID_CONFLICT" });
    const actorId = request.headers.get("X-Producer-UserId");
    const emergencyStop = action === "facebook.output.stop" || action === "preview.stop" || action === "archive.camera.stop" || action === "obs.recording.stop";
    if (actorId && !emergencyStop) {
      const lease = await storage.get<ControlLease>(CONTROL_LEASE_KEY);
      if (!lease || lease.expiresAt <= Date.now() || lease.userId !== actorId) return json(409, { error: "CONTROL_LEASE_REQUIRED" });
      const status = await storage.get<StoredDocument>(STATUS_KEY);
      if (bridgeState(status) !== "ONLINE") return json(409, { error: "BRIDGE_OFFLINE" });
      if (action !== "preview.start" && status?.body.stateRevision !== expected) return json(409, { error: "STATE_CHANGED" });
      if (action === "facebook.output.start") {
        const current = status!.body;
        const managed = await storage.get<import("./facebook-lifecycle").ManagedBroadcast>(BROADCAST_KEY);
        const operations = await storage.get<Array<{ action: string; state: string }>>(BROADCAST_OPERATIONS_KEY) ?? [];
        if (operations.some(item => item.action === "prepare" && ["pending", "unknown"].includes(item.state))) return json(409, { error: "FACEBOOK_PREPARE_UNRESOLVED" });
        if (managed && (!["UNPUBLISHED", "PUBLISH_REQUESTED", "LIVE"].includes(managed.status) || (body?.payload as { videoId?: string } | undefined)?.videoId !== managed.id || (current.broadcast as { managedVideoId?: string } | undefined)?.managedVideoId !== managed.id)) return json(409, { error: "MANAGED_DESTINATION_NOT_READY" });
        const previews = current.previews as { program?: { state?: string } } | undefined;
        const audio = current.audio as { process?: string; available?: boolean; silence?: boolean; clipping?: boolean; lastAudioAt?: string } | undefined;
        const metrics = current.metrics as { last_video_timestamp?: string } | undefined;
        if (body?.confirmed !== true || current.source_state !== "SOURCE_LIVE" || previews?.program?.state !== "ACTIVE"
          || !metrics?.last_video_timestamp || !Number.isFinite(Date.parse(metrics.last_video_timestamp)) || Date.now() - Date.parse(metrics.last_video_timestamp) > 5_000
          || audio?.process !== "RUNNING" || !audio.available || audio.silence || audio.clipping
          || !audio.lastAudioAt || !Number.isFinite(Date.parse(audio.lastAudioAt)) || Date.now() - Date.parse(audio.lastAudioAt) > 5_000) return json(409, { error: "SOURCE_OR_AUDIO_NOT_READY" });
      }
    }
    const command: StoredCommand = { commandId, action, expectedStateRevision: expected as number, ...(body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? { payload: body.payload as Record<string, unknown> } : {}), operator: request.headers.get("X-Producer-Operator") || "unknown", createdAt: new Date().toISOString(), state: "queued" };
    commands.push(command);
    await storage.put(COMMANDS_KEY, commands.slice(-MAX_COMMANDS));
    return json(202, command);
  }
  if (path === "/api/producer/v1/workstation/commands" && request.method === "GET") {
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
    for (const command of commands) if (command.state === "queued" && Date.now() - Date.parse(command.createdAt) > 15_000) { command.state = "timed_out"; command.completedAt = new Date().toISOString(); }
    await storage.put(COMMANDS_KEY, commands);
    return json(200, { commands: commands.filter((item) => item.state === "queued").slice(0, 20) });
  }
  if (path === "/api/producer/v1/workstation/ack" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    if (typeof body?.commandId !== "string" || !COMMAND_ID.test(body.commandId) || !["succeeded", "failed", "timed_out"].includes(String(body.state))) return json(400, { error: "INVALID_ACK" });
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
    const command = commands.find((item) => item.commandId === body.commandId);
    if (!command) return json(404, { error: "COMMAND_NOT_FOUND" });
    command.state = body.state as StoredCommand["state"];
    command.result = body.result;
    command.completedAt = new Date().toISOString();
    await storage.put(COMMANDS_KEY, commands);
    return json(200, command);
  }
  const commandMatch = /^\/api\/producer\/v1\/commands\/([0-9a-f-]+)$/.exec(path);
  if (commandMatch && request.method === "GET") {
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
    const command = commands.find((item) => item.commandId === commandMatch[1]);
    return command ? json(200, command) : json(404, { error: "COMMAND_NOT_FOUND" });
  }
  return json(404, { error: "NOT_FOUND" });
}

export class ProducerBridge implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}
  fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(() => handleProducerStateRequest(request, this.state.storage));
  }
}
