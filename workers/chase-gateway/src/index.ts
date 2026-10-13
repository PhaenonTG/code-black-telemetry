// codeblack-chase-gateway -- standalone Cloudflare Worker owning `ops.codeblackwx.com/api/chase/*`
// (a Worker route on that zone, which takes precedence over the codeblack-ops Pages project on
// this specific path prefix -- see ../../web/ops for the Pages project itself).
//
// RECONSTRUCTED, not original. The hand-authored TypeScript source for this Worker was never
// found in any repo or backup (see services/core-api/CHASE_LOCATION_RECOVERY.md for the sibling
// Core-side recovery, and the recovery session's forensic report for what was searched). This
// file was rebuilt by decompiling the actual deployed bundle (pulled live from the Cloudflare
// API, `workers_get_worker_code` for script "codeblack-chase-gateway") back into readable,
// idiomatic source with the same structure `workers/core-gateway` uses elsewhere in this repo.
// The deployed bundle remains the sole behavioral authority: every route, status code, header,
// and edge case below was reproduced to match it exactly, not designed fresh. Do not "clean up"
// behavior here without first re-diffing against a fresh pull of the live bundle.
//
// Three routes, forwarded to Core over a Workers VPC Service binding (CORE_VPC) at
// http://127.0.0.1:8000 -- the same transport pattern as workers/core-gateway:
//   POST /api/chase/location          -- ingest a GPS heartbeat (Bearer CHASE_TOKEN required)
//   GET  /api/chase/location/latest   -- read any unit's latest fix  (Bearer CHASE_TOKEN required)
//   GET  /api/chase/location/public   -- unauthenticated read of ONE hardcoded public unit, with
//                                         the token injected server-side so the overlay page
//                                         (whose source is public) never holds it.
export { ProducerBridge } from "./producer-bridge";
import { handleFacebookLifecycle } from "./facebook-lifecycle";

const CORE_ORIGIN = "http://127.0.0.1:8000";
const MAX_BODY_BYTES = 16 * 1024;
const CONFIG_PATH = "/api/chase/v1/config";
const TELEMETRY_PATH = "/api/chase/v1/telemetry";
const COMMENTS_PATH = "/api/chase/v1/comments";
const FACEBOOK_CONNECT_SESSION_PATH = "/api/chase/v1/facebook/connect-session";
const FACEBOOK_CONNECT_PATH = "/api/chase/v1/facebook/connect";
const FACEBOOK_CALLBACK_PATH = "/api/chase/v1/facebook/callback";
const FACEBOOK_CONNECTION_STATUS_PATH = "/api/chase/v1/facebook/status";
const FACEBOOK_REPLY_PATH = "/api/chase/v1/facebook/reply";
const FACEBOOK_REDIRECT_URI = "https://ops.codeblackwx.com/api/chase/v1/facebook/callback";
const FACEBOOK_GRAPH_ORIGIN = "https://graph.facebook.com/v26.0";
const COMMENT_POLL_AFTER_MS = 2_000;
const MAX_COMMENT_CURSOR_LENGTH = 32;
// This relay is deliberately single-Page. The label is operator-facing identity only; the
// numeric Page ID and Graph credential remain Worker secrets.
const FACEBOOK_PAGE_LABEL = "Storm Chaser Nick Mounce";

const PUBLIC_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const PUBLIC_UNIT_ID = "cbwx-unit-tessa";
const PUBLIC_FRESH_MS = 15_000;

export interface VpcServiceBinding {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface AssetBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  CORE_VPC?: VpcServiceBinding;
  // Shared bearer secret. Checked against the caller's `Authorization: Bearer <token>` header on
  // every authenticated route, and injected server-side (never exposed) on the public route.
  CHASE_TOKEN?: string;
  // The same public Supabase project configuration used by Code Black OPS. These are public
  // client values, stored as Worker secrets to avoid accidental source/config drift. No service
  // role key is ever used by Chase or this Worker.
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  // Page-scoped Graph credentials used only by the server-side comments relay. Both are Worker
  // secrets; neither is returned to Chase, logged, or committed to this repository.
  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  FACEBOOK_APP_ID?: string;
  FACEBOOK_APP_SECRET?: string;
  FACEBOOK_TOKEN_KEK?: string;
  FACEBOOK_CONNECTOR_USER_IDS?: string;
  FACEBOOK_REPLIES_ENABLED?: string;
  FACEBOOK_LIFECYCLE_ENABLED?: string;
  // Static release manifest and APK. Absent until a Chase release is published.
  ASSETS?: AssetBinding;
  PRODUCER_BRIDGE?: DurableObjectNamespace;
  PRODUCER_BRIDGE_TOKEN?: string;
  PRODUCER_CONTROLS_ENABLED?: string;
  PRODUCER_OPERATOR_IDS?: string;
}

interface PublicLocationResponse {
  unit_id: string;
  location_sharing: boolean;
  stale: boolean;
  lat?: number;
  lon?: number;
}

interface CoreLatestResponse {
  unit_id?: string;
  location_sharing?: boolean;
  stale?: boolean;
  receiver_age_ms?: number;
  fix_age_ms?: number;
  lat?: number;
  lon?: number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function publicJson(status: number, body: unknown): Response {
  const response = json(status, body);
  for (const [name, value] of Object.entries(PUBLIC_CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function legacyAuthorized(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = request.headers.get("Authorization") || "";
  return header === `Bearer ${expected}`;
}

type GraphComment = {
  id?: unknown;
  from?: { name?: unknown };
  message?: unknown;
  created_time?: unknown;
};

type RelayComment = {
  id: string;
  author: string;
  message: string;
  createdAt: string;
};

function commentResponse(
  state: string,
  cursor: string,
  comments: RelayComment[] = [],
  pollAfterMs = COMMENT_POLL_AFTER_MS,
  facebookLive = false,
): Response {
  return json(200, {
    state,
    cursor,
    pollAfterMs,
    comments,
    page: { label: FACEBOOK_PAGE_LABEL, live: facebookLive },
  });
}

function validFacebookPageId(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{5,30}$/.test(value);
}

function validCommentCursor(value: string | null): value is string {
  return value !== null && /^\d{10,13}$/.test(value) && value.length <= MAX_COMMENT_CURSOR_LENGTH;
}

type StoredFacebookCredential = {
  pageId: string;
  label: string;
  ciphertext: string;
  iv: string;
  connectedAt: string;
  connectedBy: string;
  permissions?: string[];
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padding = (4 - (value.length % 4)) % 4;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padding);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function facebookEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`codeblack-facebook-page-token-v1:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptFacebookToken(token: string, secret: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await facebookEncryptionKey(secret), new TextEncoder().encode(token));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}

async function decryptFacebookToken(credential: StoredFacebookCredential, secret: string): Promise<string | null> {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(credential.iv) },
      await facebookEncryptionKey(secret),
      fromBase64Url(credential.ciphertext),
    );
    const token = new TextDecoder().decode(decrypted);
    return token.length >= 40 && token.length <= 2_000 ? token : null;
  } catch {
    return null;
  }
}

async function facebookBroker(env: Env, path: string, init?: RequestInit): Promise<Response> {
  if (!env.PRODUCER_BRIDGE) return json(503, { error: "FACEBOOK_CONNECTOR_UNAVAILABLE" });
  const id = env.PRODUCER_BRIDGE.idFromName("native-producer");
  return env.PRODUCER_BRIDGE.get(id).fetch(new Request(`https://facebook-broker.internal${path}`, init));
}

async function storedFacebookCredential(env: Env): Promise<(StoredFacebookCredential & { token: string }) | null> {
  if (!env.PRODUCER_BRIDGE || !env.FACEBOOK_TOKEN_KEK) return null;
  try {
    const response = await facebookBroker(env, "/api/chase/v1/facebook/internal/credential");
    if (!response.ok) return null;
    const credential = await response.json() as StoredFacebookCredential;
    if (!validFacebookPageId(credential.pageId) || credential.pageId !== env.FACEBOOK_PAGE_ID) return null;
    const token = await decryptFacebookToken(credential, env.FACEBOOK_TOKEN_KEK);
    return token ? { ...credential, token } : null;
  } catch {
    return null;
  }
}

function normalizeGraphComments(data: unknown, previousCursor: string): { cursor: string; comments: RelayComment[] } {
  if (!data || typeof data !== "object" || !Array.isArray((data as { data?: unknown }).data)) {
    return { cursor: previousCursor, comments: [] };
  }
  let latest = Number(previousCursor) || 0;
  const comments: RelayComment[] = [];
  for (const item of (data as { data: GraphComment[] }).data) {
    if (!item || typeof item.id !== "string" || typeof item.message !== "string" || typeof item.created_time !== "string") continue;
    const createdAtMs = Date.parse(item.created_time);
    if (!Number.isFinite(createdAtMs)) continue;
    latest = Math.max(latest, Math.floor(createdAtMs / 1000));
    comments.push({
      id: item.id,
      author: typeof item.from?.name === "string" && item.from.name.trim() ? item.from.name.slice(0, 120) : "Viewer",
      message: item.message.slice(0, 2_000),
      createdAt: new Date(createdAtMs).toISOString(),
    });
  }
  return { cursor: latest > 0 ? String(latest) : previousCursor, comments };
}

/**
 * Reads comments from the currently LIVE Page video without exposing Meta credentials to the
 * mobile app. This deliberately has no Core dependency: the Worker is the public boundary.
 */
async function forwardFacebookComments(url: URL, env: Env): Promise<Response> {
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
  let liveResponse: Response;
  try {
    liveResponse = await fetch(pageUrl, { headers: { Authorization: `Bearer ${pageToken}` } });
  } catch {
    return commentResponse("reconnecting", cursor);
  }
  if (liveResponse.status === 429) return new Response(JSON.stringify({ state: "rate_limited", cursor, pollAfterMs: 10_000, comments: [] }), { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "10" } });
  if (!liveResponse.ok) return graphFailureResponse(liveResponse, cursor);
  let liveData: { data?: Array<{ id?: unknown }> };
  try { liveData = await liveResponse.json() as { data?: Array<{ id?: unknown }> }; } catch { return commentResponse("reconnecting", cursor); }
  const liveId = Array.isArray(liveData.data) ? liveData.data.find((video) => typeof video?.id === "string")?.id : undefined;
  if (typeof liveId !== "string") return commentResponse("ok", cursor);

  const commentsUrl = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${liveId}/comments`);
  commentsUrl.searchParams.set("filter", "stream");
  commentsUrl.searchParams.set("order", "reverse_chronological");
  commentsUrl.searchParams.set("live_filter", "filter_low_quality");
  commentsUrl.searchParams.set("fields", "id,from{name},message,created_time");
  commentsUrl.searchParams.set("limit", "100");
  if (cursor) commentsUrl.searchParams.set("since", cursor);
  let commentsResponse: Response;
  try {
    commentsResponse = await fetch(commentsUrl, { headers: { Authorization: `Bearer ${pageToken}` } });
  } catch {
    return commentResponse("reconnecting", cursor);
  }
  if (commentsResponse.status === 429) return new Response(JSON.stringify({ state: "rate_limited", cursor, pollAfterMs: 10_000, comments: [] }), { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "10" } });
  if (!commentsResponse.ok) return graphFailureResponse(commentsResponse, cursor);
  try {
    const normalized = normalizeGraphComments(await commentsResponse.json(), cursor);
    if (stored?.permissions?.includes("pages_manage_engagement") && env.PRODUCER_BRIDGE) {
      await facebookBroker(env, "/api/chase/v1/facebook/internal/targets", {
        method: "POST", body: JSON.stringify({ pageId: env.FACEBOOK_PAGE_ID, liveId, ids: normalized.comments.map(item => item.id) }),
      });
    }
    return commentResponse("ok", normalized.cursor, normalized.comments, COMMENT_POLL_AFTER_MS, true);
  } catch {
    return commentResponse("reconnecting", cursor);
  }
}

async function sharedFacebookComments(url: URL, env: Env): Promise<Response> {
  if (!env.PRODUCER_BRIDGE) return forwardFacebookComments(url, env);
  const reserve = await facebookBroker(env, "/api/chase/v1/facebook/internal/comment-cache", { method: "POST", body: JSON.stringify({ operation: "reserve" }) });
  if (reserve.status === 200) {
    const cached = await reserve.json() as { payload: Record<string, unknown> };
    return json(200, cached.payload);
  }
  // During a rolling DO upgrade, do not multiply Meta calls across every polling client.
  if (reserve.status !== 202) return commentResponse("reconnecting", "", [], 60_000);
  const sharedUrl = new URL(url); sharedUrl.searchParams.delete("after");
  const response = await forwardFacebookComments(sharedUrl, env);
  const payload = await response.json() as Record<string, unknown>;
  const page = payload.page as { live?: boolean } | undefined;
  payload.pollAfterMs = payload.state === "rate_limited" ? 600_000 : payload.state !== "ok" || !page?.live ? 60_000 : 30_000;
  await facebookBroker(env, "/api/chase/v1/facebook/internal/comment-cache", { method: "POST", body: JSON.stringify({ operation: "save", payload }) });
  return json(200, payload);
}

// Meta commonly reports expired tokens and permission failures as HTTP 400. Treat those as
// authorization failures instead of making the app claim it is endlessly reconnecting.
async function graphFailureResponse(response: Response, cursor: string): Promise<Response> {
  try {
    const result = await response.json() as { error?: { code?: number } };
    const code = result.error?.code;
    if (code === 190 || code === 102 || code === 10 || code === 200) return commentResponse("auth_failed", cursor, [], 60_000);
    if (code === 4 || code === 17 || code === 32 || code === 613) return commentResponse("rate_limited", cursor, [], 60_000);
  } catch { /* Never relay Meta error bodies or credential material to a client. */ }
  return commentResponse(response.status === 401 || response.status === 403 ? "auth_failed" : "reconnecting", cursor, [], 5_000);
}

/**
 * Authenticates a Chase operator through Supabase and its existing active-profile policy.
 * During the signed migration window the pre-auth Chase token remains accepted so installed
 * field clients never lose a working uplink; it is not returned to authenticated clients.
 */
type ChaseCaller = { userId?: string; operatorName?: string; vehicleName?: string };

/**
 * Resolves the active, server-managed OPS profile. The display name is presentation data only:
 * authorization still depends exclusively on the active row, never on an email-derived value.
 */
function displayNameFromProfileEmail(email: unknown): string | undefined {
  if (typeof email !== "string") return undefined;
  const local = email.trim().split("@", 1)[0] ?? "";
  const name = local
    .split(/[._+\-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 24);
  return name || undefined;
}

function displayNameFromProfile(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().slice(0, 24);
  return /^[\p{L}\p{N} .'-]{1,24}$/u.test(name) ? name : undefined;
}

function vehicleNameFromProfile(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const vehicle = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(vehicle) ? vehicle : undefined;
}

async function authorizeCaller(request: Request, env: Env, allowLegacy = true): Promise<ChaseCaller | null> {
  // Legacy field installs remain usable during migration, but cannot claim a user identity.
  if (allowLegacy && legacyAuthorized(request, env.CHASE_TOKEN)) return {};
  const header = request.headers.get("Authorization") ?? ""
  if (!header.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null
  const token = header.slice("Bearer ".length).trim()
  if (!token) return null
  const headers = { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_PUBLISHABLE_KEY }
  try {
    const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers })
    if (!userResponse.ok) return null
    const user = await userResponse.json() as { id?: string }
    if (!user.id) return null
    const profileResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/profiles?select=active,email,operator_name,vehicle_id&user_id=eq.${encodeURIComponent(user.id)}`,
      { headers },
    )
    if (!profileResponse.ok) return null
    const profiles = await profileResponse.json() as Array<{
      active?: boolean; email?: unknown; operator_name?: unknown; vehicle_id?: unknown;
    }>
    const profile = Array.isArray(profiles) ? profiles.find((candidate) => candidate.active === true) : undefined
    return profile
      ? {
          userId: user.id,
          operatorName: displayNameFromProfile(profile.operator_name) ?? displayNameFromProfileEmail(profile.email),
          vehicleName: vehicleNameFromProfile(profile.vehicle_id),
        }
      : null
  } catch {
    return null
  }
}

function facebookConnectorAllowed(caller: ChaseCaller, env: Env): boolean {
  if (!caller.userId) return false;
  return (env.FACEBOOK_CONNECTOR_USER_IDS || "").split(",").map((id) => id.trim()).filter(Boolean).includes(caller.userId);
}

function facebookConnectorConfigured(env: Env): boolean {
  return Boolean(
    env.PRODUCER_BRIDGE
    && validFacebookPageId(env.FACEBOOK_PAGE_ID)
    && /^\d{5,30}$/.test(env.FACEBOOK_APP_ID || "")
    && (env.FACEBOOK_APP_SECRET?.length ?? 0) >= 20
    && (env.FACEBOOK_TOKEN_KEK?.length ?? 0) >= 40,
  );
}

function facebookReplyAllowed(caller: ChaseCaller, env: Env): boolean {
  return env.FACEBOOK_REPLIES_ENABLED === "true" && Boolean(caller.userId && (env.PRODUCER_OPERATOR_IDS || "").split(",").map(id => id.trim()).includes(caller.userId));
}

async function handleFacebookReply(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  const caller = await authorizeCaller(request, env, false);
  if (!caller) return json(401, { error: "AUTH_REQUIRED" });
  if (!facebookReplyAllowed(caller, env)) return json(403, { error: "FACEBOOK_REPLY_FORBIDDEN" });
  if (Number(request.headers.get("Content-Length") || 0) > 8192) return json(413, { error: "REPLY_TOO_LARGE" });
  let body: { commentId?: unknown; message?: unknown; requestId?: unknown; confirmed?: unknown };
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 8192) return json(413, { error: "REPLY_TOO_LARGE" });
    body = JSON.parse(text);
  } catch { return json(400, { error: "INVALID_REPLY" }); }
  if (!body || body.confirmed !== true || typeof body.commentId !== "string" || !/^[0-9_]{5,100}$/.test(body.commentId)
    || typeof body.message !== "string" || !body.message.trim() || body.message.length > 2000
    || typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) return json(400, { error: "INVALID_REPLY" });
  const credential = await storedFacebookCredential(env);
  if (!credential?.permissions?.includes("pages_manage_engagement")) return json(409, { error: "FACEBOOK_REPLY_PERMISSION_REQUIRED" });
  let liveId: string | undefined;
  try {
    const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/${credential.pageId}/live_videos?broadcast_status=%5B%22LIVE%22%5D&fields=id`, {
      headers: { Authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return json(409, { error: "FACEBOOK_LIVE_UNAVAILABLE" });
    const videos = await response.json() as { data?: Array<{ id?: string }> };
    liveId = videos.data?.[0]?.id;
  } catch { return json(503, { error: "FACEBOOK_UNAVAILABLE" }); }
  if (!liveId) return json(409, { error: "NO_ACTIVE_FACEBOOK_LIVE" });
  const digest = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([body.commentId, body.message.trim()])))));
  const reserved = await facebookBroker(env, "/api/chase/v1/facebook/internal/reply", {
    method: "POST", body: JSON.stringify({ requestId: body.requestId, userId: caller.userId, digest, commentId: body.commentId, pageId: credential.pageId, liveId }),
  });
  if (reserved.status !== 202) {
    if (reserved.status !== 200) return reserved;
    const prior = await reserved.json() as { state: string; replyId?: string };
    return json(prior.state === "sent" ? 200 : 409, { state: prior.state, replyId: prior.replyId, error: prior.state === "sent" ? undefined : "REPLY_ALREADY_ATTEMPTED" });
  }
  let state = "unknown"; let replyId: string | undefined;
  try {
    const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/${body.commentId}/comments`, {
      method: "POST", headers: { Authorization: `Bearer ${credential.token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: body.message.trim() }), signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      const result = await response.json() as { id?: unknown };
      if (typeof result.id === "string") { state = "sent"; replyId = result.id; }
    } else if (response.status >= 400 && response.status < 500) state = "failed";
  } catch { /* A timeout can occur after Meta publishes; never automatically retry. */ }
  await facebookBroker(env, "/api/chase/v1/facebook/internal/reply-result", {
    method: "POST", body: JSON.stringify({ requestId: body.requestId, userId: caller.userId, state, replyId }),
  });
  return json(state === "sent" ? 200 : 502, { state, replyId, error: state === "sent" ? undefined : state === "unknown" ? "REPLY_OUTCOME_UNKNOWN" : "FACEBOOK_REPLY_REJECTED" });
}

function facebookResultPage(title: string, message: string, success = false): Response {
  const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
  const color = success ? "#36e37d" : "#ff5d67";
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${safeTitle}</title><style>body{margin:0;background:#07090c;color:#fff;font-family:system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{max-width:34rem;margin:1.5rem;padding:2rem;border:1px solid #28303a;border-radius:14px;background:#0f1319}h1{margin:0 0 1rem;color:${color};font-size:1.4rem}p{line-height:1.5;color:#c8d0da}</style></head><body><main class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p><p>You may close this window and return to Chase.</p></main></body></html>`;
  const resultHtml = html.replace("You may close this window and return to Chase.", 'Return to Chase, or <a style="color:#8bc9ef" href="/producer">open the Producer console</a>.');
  return new Response(resultHtml, { status: success ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}

async function graphTokenExchange(parameters: Record<string, string>): Promise<string | null> {
  try {
    const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(parameters),
    });
    if (!response.ok) return null;
    const body = await response.json() as { access_token?: unknown };
    return typeof body.access_token === "string" && body.access_token.length >= 40 ? body.access_token : null;
  } catch {
    return null;
  }
}

async function handleFacebookConnector(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === FACEBOOK_CONNECT_SESSION_PATH) {
    if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
    const caller = await authorizeCaller(request, env, false);
    if (!caller) return json(401, { error: "AUTH_REQUIRED" });
    if (!facebookConnectorAllowed(caller, env)) return json(403, { error: "FACEBOOK_CONNECT_FORBIDDEN" });
    if (!facebookConnectorConfigured(env)) return json(503, { error: "FACEBOOK_CONNECT_NOT_CONFIGURED" });
    const ticket = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const accepted = await facebookBroker(env, "/api/chase/v1/facebook/internal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, userId: caller.userId, createdAt: new Date().toISOString() }),
    });
    if (!accepted.ok) return json(503, { error: "FACEBOOK_CONNECT_UNAVAILABLE" });
    return json(200, { connectUrl: `https://ops.codeblackwx.com${FACEBOOK_CONNECT_PATH}?ticket=${ticket}`, expiresInSeconds: 600 });
  }

  if (url.pathname === FACEBOOK_CONNECTION_STATUS_PATH) {
    if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
    const caller = await authorizeCaller(request, env, false);
    if (!caller) return json(401, { error: "AUTH_REQUIRED" });
    const credential = await storedFacebookCredential(env);
    let health: { state: string; httpStatus?: number; code?: number; subcode?: number } | undefined;
    if (credential && url.searchParams.get("diagnostics") === "1" && facebookConnectorAllowed(caller, env)) {
      try {
        const probe = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/${credential.pageId}/live_videos?broadcast_status=%5B%22LIVE%22%5D&fields=id`, { headers: { Authorization: `Bearer ${credential.token}` }, signal: AbortSignal.timeout(8000) });
        const result = await probe.json() as { error?: { code?: number; error_subcode?: number } };
        health = { state: probe.ok ? "healthy" : "auth_failed", httpStatus: probe.status, code: result.error?.code, subcode: result.error?.error_subcode };
      } catch { health = { state: "unavailable" }; }
    }
    return json(200, credential
      ? { state: "connected", page: { id: credential.pageId, label: credential.label }, connectedAt: credential.connectedAt, health, canConnect: facebookConnectorAllowed(caller, env), canReply: facebookReplyAllowed(caller, env) && credential.permissions?.includes("pages_manage_engagement") === true }
      : { state: facebookConnectorConfigured(env) ? "not_connected" : "not_configured", page: { label: FACEBOOK_PAGE_LABEL }, canConnect: facebookConnectorAllowed(caller, env), canReply: false });
  }

  if (url.pathname === FACEBOOK_CONNECT_PATH) {
    if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
    if (!facebookConnectorConfigured(env)) return facebookResultPage("Facebook connection unavailable", "Code Black has not finished configuring this connection.");
    const ticket = url.searchParams.get("ticket") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return facebookResultPage("Link expired", "Open Facebook connection from Chase again.");
    const session = await facebookBroker(env, `/api/chase/v1/facebook/internal/session?ticket=${encodeURIComponent(ticket)}`);
    if (!session.ok) return facebookResultPage("Link expired", "Open Facebook connection from Chase again.");
    const authorize = new URL("https://www.facebook.com/v26.0/dialog/oauth");
    authorize.searchParams.set("client_id", env.FACEBOOK_APP_ID!);
    authorize.searchParams.set("redirect_uri", FACEBOOK_REDIRECT_URI);
    authorize.searchParams.set("state", ticket);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", `pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_engagement${env.FACEBOOK_LIFECYCLE_ENABLED === "true" ? ",pages_manage_posts" : ""}`);
    authorize.searchParams.set("auth_type", "rerequest");
    return Response.redirect(authorize.toString(), 302);
  }

  if (url.pathname === FACEBOOK_CALLBACK_PATH) {
    if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
    if (!facebookConnectorConfigured(env)) return facebookResultPage("Facebook connection unavailable", "Code Black has not finished configuring this connection.");
    if (url.searchParams.has("error")) return facebookResultPage("Facebook connection cancelled", "No Page access was changed.");
    const ticket = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket) || code.length < 20 || code.length > 2_000) return facebookResultPage("Link expired", "Open Facebook connection from Chase again.");
    const sessionResponse = await facebookBroker(env, `/api/chase/v1/facebook/internal/session?ticket=${encodeURIComponent(ticket)}`);
    if (!sessionResponse.ok) return facebookResultPage("Link expired", "Open Facebook connection from Chase again.");
    const session = await sessionResponse.json() as { userId?: string };
    if (!session.userId || !(env.FACEBOOK_CONNECTOR_USER_IDS || "").split(",").map((id) => id.trim()).includes(session.userId)) {
      return facebookResultPage("Connection rejected", "This OPS account is not permitted to connect the Page.");
    }
    const shortToken = await graphTokenExchange({ client_id: env.FACEBOOK_APP_ID!, client_secret: env.FACEBOOK_APP_SECRET!, redirect_uri: FACEBOOK_REDIRECT_URI, code });
    if (!shortToken) return facebookResultPage("Facebook connection failed", "Meta did not accept the authorization response. Please try again from Chase.");
    const longToken = await graphTokenExchange({ grant_type: "fb_exchange_token", client_id: env.FACEBOOK_APP_ID!, client_secret: env.FACEBOOK_APP_SECRET!, fb_exchange_token: shortToken });
    if (!longToken) return facebookResultPage("Facebook connection failed", "Meta did not issue a long-lived authorization. Please try again from Chase.");
    let permissions: string[] = [];
    try {
      const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/me/permissions`, { headers: { Authorization: `Bearer ${longToken}` } });
      const result = await response.json() as { data?: Array<{ permission?: string; status?: string }>; error?: { code?: number } };
      if (!response.ok) return facebookResultPage("Permission check unavailable", `Meta rejected its permission check${typeof result.error?.code === "number" ? ` (code ${result.error.code})` : ""}. The existing Page credential was preserved. Try reconnecting after Meta is available again.`);
      if (response.ok && Array.isArray(result.data)) permissions = result.data.filter(item => item.status === "granted" && typeof item.permission === "string").map(item => item.permission!);
    } catch { return facebookResultPage("Permission check failed", "Facebook permissions could not be verified. Reconnect from Producer."); }
    const missing = ["pages_show_list", "pages_read_engagement", "pages_read_user_content"].filter(item => !permissions.includes(item));
    if (missing.length) return facebookResultPage("Facebook permissions missing", `Meta did not grant: ${missing.join(", ")}. The existing Page credential was preserved. Reconnect from Producer and grant the missing access.`);
    let accounts: { data?: Array<{ id?: unknown; name?: unknown; access_token?: unknown }> };
    try {
      const response = await fetch(`${FACEBOOK_GRAPH_ORIGIN}/me/accounts?fields=id,name,access_token&limit=100`, { headers: { Authorization: `Bearer ${longToken}`, Accept: "application/json" } });
      if (!response.ok) return facebookResultPage("Page access unavailable", "Facebook did not return a Page that this account manages.");
      accounts = await response.json() as typeof accounts;
    } catch {
      return facebookResultPage("Facebook connection failed", "The Page list could not be verified. Please try again from Chase.");
    }
    const page = Array.isArray(accounts.data) ? accounts.data.find((item) => item.id === env.FACEBOOK_PAGE_ID) : undefined;
    if (!page || typeof page.access_token !== "string" || page.access_token.length < 40) {
      return facebookResultPage("Nick's Page was not authorized", `Select ${FACEBOOK_PAGE_LABEL} when Facebook asks which Page to connect.`);
    }
    const encrypted = await encryptFacebookToken(page.access_token, env.FACEBOOK_TOKEN_KEK!);
    const credential: StoredFacebookCredential = {
      pageId: env.FACEBOOK_PAGE_ID!,
      label: typeof page.name === "string" && page.name.trim() ? page.name.slice(0, 120) : FACEBOOK_PAGE_LABEL,
      ...encrypted,
      connectedAt: new Date().toISOString(),
      connectedBy: session.userId,
      permissions,
    };
    const stored = await facebookBroker(env, "/api/chase/v1/facebook/internal/credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, credential }),
    });
    return stored.ok
      ? facebookResultPage("Facebook comments connected", `${credential.label} is connected. ${permissions.includes("pages_manage_engagement") ? "Authorized producers can reply as the Page." : "Replies require reconnecting with comment-management permission."}`, true)
      : facebookResultPage("Facebook connection failed", "The credential could not be stored. Please try again from Chase.");
  }

  return json(404, { error: "NOT_FOUND" });
}

function producerWorkstationAuthorized(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") || "";
  return Boolean(env.PRODUCER_BRIDGE_TOKEN && header === `Bearer ${env.PRODUCER_BRIDGE_TOKEN}`);
}

function producerOperatorAllowed(caller: ChaseCaller, env: Env): boolean {
  if (env.PRODUCER_CONTROLS_ENABLED !== "true" || !caller.userId) return false;
  return (env.PRODUCER_OPERATOR_IDS || "").split(",").map((id) => id.trim()).filter(Boolean).includes(caller.userId);
}

async function handleProducerRoute(request: Request, url: URL, env: Env): Promise<Response> {
  if (!env.PRODUCER_BRIDGE) return json(503, { error: "BRIDGE_NOT_CONFIGURED" });
  const workstation = url.pathname.startsWith("/api/producer/v1/workstation/");
  let operator = "workstation";
  let userId: string | undefined;
  let controlAllowed = false;
  if (workstation) {
    if (!producerWorkstationAuthorized(request, env)) return json(401, { error: "AUTH_REQUIRED" });
  } else {
    const caller = await authorizeCaller(request, env, false);
    if (!caller) return json(401, { error: "AUTH_REQUIRED" });
    operator = caller.operatorName || caller.userId || "operator";
    userId = caller.userId;
    controlAllowed = producerOperatorAllowed(caller, env);
    if (!["GET", "HEAD"].includes(request.method) && !controlAllowed) return json(403, { error: "PRODUCER_CONTROL_FORBIDDEN" });
  }
  const id = env.PRODUCER_BRIDGE.idFromName("native-producer");
  const stub = env.PRODUCER_BRIDGE.get(id);
  if (url.pathname === "/api/producer/v1/facebook" || url.pathname.startsWith("/api/producer/v1/facebook/") || ["/api/producer/v1/workstation/facebook-destination", "/api/producer/v1/workstation/facebook-health"].includes(url.pathname)) {
    return handleFacebookLifecycle(request, userId, controlAllowed, workstation, {
      credential: () => storedFacebookCredential(env),
      broker: (path, init) => facebookBroker(env, path, init),
      encrypt: (value) => encryptFacebookToken(value, env.FACEBOOK_TOKEN_KEK!),
      decrypt: (value) => decryptFacebookToken(value as StoredFacebookCredential, env.FACEBOOK_TOKEN_KEK!),
      fetch: (input, init) => fetch(input, init),
      enabled: env.FACEBOOK_LIFECYCLE_ENABLED === "true",
    });
  }
  const headers = new Headers();
  for (const name of ["Content-Type", "Content-Length", "X-Producer-Frame-At", "X-Producer-Composition"]) {
    const value = request.headers.get(name); if (value) headers.set(name, value);
  }
  headers.set("X-Producer-Operator", operator);
  if (userId) headers.set("X-Producer-UserId", userId);
  const response = await stub.fetch(new Request(request.url, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body }));
  if (!workstation && request.method === "GET" && url.pathname === "/api/producer/v1/status" && response.ok) {
    const document = await response.json() as Record<string, unknown>;
    if (!("status" in document) && "producer" in document) document.status = document.producer;
    document.controlAccess = { allowed: controlAllowed, userId };
    return json(response.status, document);
  }
  return response;
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  return (await authorizeCaller(request, env)) !== null;
}

async function forwardPost(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_BODY_BYTES) return json(413, { error: "PAYLOAD_TOO_LARGE" });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return json(413, { error: "PAYLOAD_TOO_LARGE" });
  return env.CORE_VPC!.fetch(`${CORE_ORIGIN}/api/chase/location`, {
    method: "POST",
    headers: {
      Authorization: request.headers.get("Authorization") ?? "",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
  });
}

async function forwardConfig(env: Env, caller: ChaseCaller): Promise<Response> {
  if (!env.CHASE_TOKEN) return json(503, { error: "CORE_UNAVAILABLE" });
  const response = await env.CORE_VPC!.fetch(`${CORE_ORIGIN}/api/chase/v1/config`, {
    headers: { Authorization: `Bearer ${env.CHASE_TOKEN}`, Accept: "application/json" },
  });
  // Configuration can contain temporary operational credentials. It must never be retained by
  // a browser, intermediary cache, or another client after this tightly scoped response.
  // The unit and operational values stay Core-authoritative; only the header's operator and
  // assigned-vehicle labels are tailored from the authenticated, RLS-protected OPS profile.
  if (response.ok && (caller.operatorName || caller.vehicleName)) {
    try {
      const document = await response.json() as Record<string, unknown>;
      const profile = document.profile && typeof document.profile === "object" && !Array.isArray(document.profile)
        ? document.profile as Record<string, unknown>
        : {};
      document.profile = {
        ...profile,
        ...(caller.operatorName ? { operator_name: caller.operatorName } : {}),
        ...(caller.vehicleName ? { vehicle_name: caller.vehicleName } : {}),
      };
      return json(response.status, document);
    } catch {
      return json(502, { error: "CONFIG_INVALID" });
    }
  }
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function forwardTelemetry(request: Request, env: Env): Promise<Response> {
  if (!env.CHASE_TOKEN) return json(503, { error: "CORE_UNAVAILABLE" });
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_BODY_BYTES) return json(413, { error: "PAYLOAD_TOO_LARGE" });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return json(413, { error: "PAYLOAD_TOO_LARGE" });
  return env.CORE_VPC!.fetch(`${CORE_ORIGIN}/api/chase/location`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CHASE_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      // This header is added only by the fixed public gateway route; callers cannot select it.
      "X-CodeBlack-Chase-Source": "public-v1",
    },
    body,
  });
}

async function forwardLatest(url: URL, request: Request, env: Env): Promise<Response> {
  const target = new URL("/api/chase/location/latest", CORE_ORIGIN);
  const unitId = url.searchParams.get("unit_id");
  if (unitId) target.searchParams.set("unit_id", unitId.slice(0, 80));
  return env.CORE_VPC!.fetch(target, {
    headers: {
      Authorization: request.headers.get("Authorization") ?? "",
      Accept: "application/json",
    },
  });
}

function isFreshAge(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= PUBLIC_FRESH_MS;
}

async function forwardPublicLatest(url: URL, env: Env): Promise<Response> {
  // The public route only ever answers for one hardcoded unit -- any other unit_id (including
  // multiple repeated params) is treated as "not a public unit", not forwarded to Core at all.
  if (url.searchParams.getAll("unit_id").some((id) => id !== PUBLIC_UNIT_ID)) {
    return publicJson(404, { error: "UNIT_NOT_PUBLIC" });
  }

  const target = new URL("/api/chase/location/latest", CORE_ORIGIN);
  target.searchParams.set("unit_id", PUBLIC_UNIT_ID);
  const response = await env.CORE_VPC!.fetch(target, {
    headers: { Authorization: `Bearer ${env.CHASE_TOKEN}`, Accept: "application/json" },
  });
  if (!response.ok) return publicJson(502, { error: "LOCATION_UNAVAILABLE" });

  const data = (await response.json()) as CoreLatestResponse | null;
  if (!data || data.unit_id !== PUBLIC_UNIT_ID) return publicJson(502, { error: "LOCATION_UNAVAILABLE" });

  const fresh =
    data.stale === false &&
    isFreshAge(data.receiver_age_ms) &&
    isFreshAge(data.fix_age_ms) &&
    (data.receiver_age_ms as number) + (data.fix_age_ms as number) <= PUBLIC_FRESH_MS;
  const validFix =
    typeof data.lat === "number" &&
    Number.isFinite(data.lat) &&
    Math.abs(data.lat) <= 90 &&
    typeof data.lon === "number" &&
    Number.isFinite(data.lon) &&
    Math.abs(data.lon) <= 180;
  const sharing = data.location_sharing === true;

  const body: PublicLocationResponse = {
    unit_id: PUBLIC_UNIT_ID,
    location_sharing: sharing,
    stale: !fresh || !validFix,
  };
  if (sharing && fresh && validFix) {
    // Rounded to 2 decimal places (~1.1km precision) -- never the raw high-precision fix -- on
    // this deliberately unauthenticated, public-CORS route.
    body.lat = Math.round((data.lat as number) * 100) / 100;
    body.lon = Math.round((data.lon as number) * 100) / 100;
  }
  return publicJson(200, body);
}

const UPDATE_PATH = "/api/chase/v1/update";
// Human-friendly stable path: always returns the checksum-verified current release.
const DOWNLOAD_PATH = "/api/chase/v1/download";
const RELEASE_PREFIX = "/api/chase/v1/releases/";
const ARCHIVE_PATH = "/api/chase/v1/releases/archive";
const ARCHIVE_PREFIX = `${ARCHIVE_PATH}/`;
const UPDATE_HOST = "ops.codeblackwx.com";

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function releaseFileName(versionCode: number): string {
  return `chase-recovery-${versionCode}.apk`;
}

function publishedManifestIsSafe(data: unknown): data is {
  versionCode: number;
  apkUrl: string;
  sha256: string;
} {
  if (!data || typeof data !== "object") return false;
  const manifest = data as Record<string, unknown>;
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
  if (typeof manifest.releaseNotes !== "string" || manifest.releaseNotes.length > 2000) return false;
  let url: URL;
  try { url = new URL(manifest.apkUrl); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
  if (url.hostname !== UPDATE_HOST) return false;
  if (url.pathname !== `${RELEASE_PREFIX}${releaseFileName(versionCode)}`) return false;
  return true;
}

type ArchivedRelease = {
  versionCode: number;
  fileName: string;
  sha256: string;
  signerSha256: string;
};

function releaseArchiveIsSafe(data: unknown): data is { releases: ArchivedRelease[] } {
  if (!data || typeof data !== "object") return false;
  const archive = data as Record<string, unknown>;
  if (archive.schema !== "codeblack.chase.release-archive" || archive.schemaVersion !== "1.0.0") return false;
  if (!Array.isArray(archive.releases) || archive.releases.length > 50) return false;
  return archive.releases.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const release = entry as Record<string, unknown>;
    return typeof release.versionCode === "number" && Number.isInteger(release.versionCode) && release.versionCode >= 1
      && release.fileName === releaseFileName(release.versionCode)
      && isSha256(release.sha256)
      && isSha256(release.signerSha256);
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readAsset(env: Env, path: string): Promise<Uint8Array | null> {
  if (!env.ASSETS) return null;
  const response = await env.ASSETS.fetch(new Request(new URL(path, "https://assets.local")));
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

async function verifiedApkResponse(env: Env, fileName: string, expectedSha256: string): Promise<Response> {
  const apk = await readAsset(env, `/${fileName}`);
  if (!apk) return json(404, { error: "NOT_FOUND" });
  const actual = await sha256Hex(apk);
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) return json(409, { error: "CHECKSUM_MISMATCH" });
  return new Response(apk, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Cache-Control": "no-store",
      "Content-Length": String(apk.byteLength),
    },
  });
}

async function handleUpdateRoute(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
  if (url.pathname === ARCHIVE_PATH || url.pathname.startsWith(ARCHIVE_PREFIX)) {
    const archiveBytes = await readAsset(env, "/release-archive.json");
    if (!archiveBytes) return json(404, { error: "ARCHIVE_NOT_FOUND" });
    let archive: unknown;
    try { archive = JSON.parse(new TextDecoder().decode(archiveBytes)); } catch { return json(500, { error: "ARCHIVE_INVALID" }); }
    if (!releaseArchiveIsSafe(archive)) return json(500, { error: "ARCHIVE_INVALID" });
    if (url.pathname === ARCHIVE_PATH) {
      return new Response(archiveBytes, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    const fileName = url.pathname.slice(ARCHIVE_PREFIX.length);
    const release = archive.releases.find((entry) => entry.fileName === fileName);
    if (!release || url.pathname !== `${ARCHIVE_PREFIX}${fileName}`) return json(404, { error: "NOT_FOUND" });
    return verifiedApkResponse(env, fileName, release.sha256);
  }
  const manifestBytes = await readAsset(env, "/update.json");
  if (!manifestBytes) return json(404, { error: "NO_UPDATE_PUBLISHED" });
  let manifest: unknown;
  try { manifest = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { return json(500, { error: "MANIFEST_INVALID" }); }
  if (!publishedManifestIsSafe(manifest)) return json(500, { error: "MANIFEST_INVALID" });
  if (url.pathname === UPDATE_PATH) {
    return new Response(manifestBytes, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (url.pathname === DOWNLOAD_PATH) {
    return verifiedApkResponse(env, releaseFileName(manifest.versionCode), manifest.sha256);
  }
  const fileName = url.pathname.slice(RELEASE_PREFIX.length);
  if (fileName !== releaseFileName(manifest.versionCode) || url.pathname !== `${RELEASE_PREFIX}${fileName}`) {
    return json(404, { error: "NOT_FOUND" });
  }
  return verifiedApkResponse(env, fileName, manifest.sha256);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
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
      return json(500, { error: "UPDATE_UNAVAILABLE" });
    }
  }

  // Facebook comments are fetched at this public Worker boundary, not from private Core.
  if (url.pathname === COMMENTS_PATH) {
    if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
    if (!(await authorized(request, env))) return json(401, { error: "AUTH_REQUIRED" });
    return sharedFacebookComments(url, env);
  }

  if (!env.CORE_VPC) return json(503, { error: "CORE_UNAVAILABLE" });

  if (url.pathname === "/api/chase/location/public") {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
    }
    if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
    if (!env.CHASE_TOKEN) return json(503, { error: "CORE_UNAVAILABLE" });
    try {
      return await forwardPublicLatest(url, env);
    } catch {
      return json(502, { error: "CORE_TRANSPORT_UNAVAILABLE" });
    }
  }

  if (url.pathname === CONFIG_PATH && request.method === "GET") {
    const caller = await authorizeCaller(request, env);
    if (!caller) return json(401, { error: "AUTH_REQUIRED" });
    try {
      return await forwardConfig(env, caller);
    } catch {
      return json(502, { error: "CORE_UNAVAILABLE" });
    }
  }

  if (!(await authorized(request, env))) return json(401, { error: "AUTH_REQUIRED" });

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
      return json(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return json(404, { error: "NOT_FOUND" });
  } catch {
    return json(502, { error: "CORE_TRANSPORT_UNAVAILABLE" });
  }
}

export default {
  fetch: handleRequest,
};
