const STATUS_KEY = "status";
const CAPABILITIES_KEY = "capabilities";
const FRAME_KEY = "program-frame";
const COMMANDS_KEY = "commands";
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
]);

export interface BridgeStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

type StoredDocument = { receivedAt: string; body: Record<string, unknown> };
type StoredFrame = { receivedAt: string; frameAt: string; bytes: ArrayBuffer };
type StoredCommand = {
  commandId: string; action: string; expectedStateRevision: number; payload?: Record<string, unknown>;
  operator: string; createdAt: string; state: "queued" | "succeeded" | "failed" | "timed_out";
  result?: unknown; completedAt?: string;
};
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
    const size = Number(request.headers.get("Content-Length") || 0);
    if (size > MAX_FRAME_BYTES || request.headers.get("Content-Type") !== "image/jpeg") return json(413, { error: "INVALID_FRAME" });
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_FRAME_BYTES) return json(413, { error: "INVALID_FRAME" });
    await storage.put(FRAME_KEY, { receivedAt: new Date().toISOString(), frameAt: request.headers.get("X-Producer-Frame-At") || new Date().toISOString(), bytes } satisfies StoredFrame);
    return json(202, { accepted: true });
  }

  if (path === "/api/producer/v1/status" && request.method === "GET") {
    const value = await storage.get<StoredDocument>(STATUS_KEY);
    const producer = value?.body ?? null;
    return json(200, {
      bridge: bridgeState(value),
      observedAt: value?.receivedAt ?? null,
      producer,
      // Compatibility alias consumed by the OPS Producer workspace.
      status: producer,
    });
  }
  if (path === "/api/producer/v1/capabilities" && request.method === "GET") {
    const value = await storage.get<StoredDocument>(CAPABILITIES_KEY);
    return json(200, { bridge: bridgeState(value), observedAt: value?.receivedAt ?? null, capabilities: value?.body ?? null });
  }
  if (path === "/api/producer/v1/preview/program.jpg" && request.method === "GET") {
    const [status, frame] = await Promise.all([storage.get<StoredDocument>(STATUS_KEY), storage.get<StoredFrame>(FRAME_KEY)]);
    const sourceLive = status?.body.source_state === "SOURCE_LIVE";
    const current = frame && Date.now() - Date.parse(frame.receivedAt) <= 5_000;
    if (!sourceLive || !current || !frame) return json(404, { error: "PREVIEW_NOT_CURRENT" });
    return new Response(frame.bytes, { status: 200, headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Producer-Frame-At": frame.frameAt, "X-Content-Type-Options": "nosniff" } });
  }

  if (path === "/api/producer/v1/commands" && request.method === "POST") {
    const body = await jsonBody(request, 4096);
    const commandId = body?.commandId;
    const action = body?.action;
    const expected = body?.expectedStateRevision;
    if (typeof commandId !== "string" || !COMMAND_ID.test(commandId) || typeof action !== "string" || !ACTIONS.has(action) || !Number.isSafeInteger(expected)) return json(400, { error: "INVALID_COMMAND" });
    if (action === "lowerThird.set" && (typeof (body?.payload as Record<string, unknown> | undefined)?.text !== "string" || String((body?.payload as Record<string, unknown>).text).length > 120)) return json(400, { error: "INVALID_PAYLOAD" });
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
    const prior = commands.find((item) => item.commandId === commandId);
    if (prior) return json(200, prior);
    const command: StoredCommand = { commandId, action, expectedStateRevision: expected as number, ...(body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? { payload: body.payload as Record<string, unknown> } : {}), operator: request.headers.get("X-Producer-Operator") || "unknown", createdAt: new Date().toISOString(), state: "queued" };
    commands.push(command);
    await storage.put(COMMANDS_KEY, commands.slice(-MAX_COMMANDS));
    return json(202, command);
  }
  if (path === "/api/producer/v1/workstation/commands" && request.method === "GET") {
    const commands = await storage.get<StoredCommand[]>(COMMANDS_KEY) ?? [];
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
    if (new URL(request.url).pathname.startsWith("/api/chase/v1/facebook/internal/")) {
      return this.state.blockConcurrencyWhile(() => handleProducerStateRequest(request, this.state.storage));
    }
    return handleProducerStateRequest(request, this.state.storage);
  }
}
