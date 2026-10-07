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

const CORE_ORIGIN = "http://127.0.0.1:8000";
const MAX_BODY_BYTES = 16 * 1024;
const CONFIG_PATH = "/api/chase/v1/config";
const TELEMETRY_PATH = "/api/chase/v1/telemetry";
const COMMENTS_PATH = "/api/chase/v1/comments";
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
  // Server-side only, for the sanitized mesonet stream projection.
  MESONET_READ_TOKEN?: string;
  // The same public Supabase project configuration used by Code Black OPS. These are public
  // client values, stored as Worker secrets to avoid accidental source/config drift. No service
  // role key is ever used by Chase or this Worker.
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  // Page-scoped Graph credentials used only by the server-side comments relay. Both are Worker
  // secrets; neither is returned to Chase, logged, or committed to this repository.
  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  // Static release manifest and APK. Absent until a Chase release is published.
  ASSETS?: AssetBinding;
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
  if (!validFacebookPageId(env.FACEBOOK_PAGE_ID) || !env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    return commentResponse("not_configured", "");
  }
  const requestedCursor = url.searchParams.get("after");
  const cursor = validCommentCursor(requestedCursor) ? requestedCursor : "";
  const pageUrl = new URL(`${FACEBOOK_GRAPH_ORIGIN}/${env.FACEBOOK_PAGE_ID}/live_videos`);
  pageUrl.searchParams.set("broadcast_status", '["LIVE"]');
  pageUrl.searchParams.set("fields", "id");
  let liveResponse: Response;
  try {
    liveResponse = await fetch(pageUrl, { headers: { Authorization: `Bearer ${env.FACEBOOK_PAGE_ACCESS_TOKEN}` } });
  } catch {
    return commentResponse("reconnecting", cursor);
  }
  if (liveResponse.status === 401 || liveResponse.status === 403) return commentResponse("auth_failed", cursor);
  if (liveResponse.status === 429) return new Response(JSON.stringify({ state: "rate_limited", cursor, pollAfterMs: 10_000, comments: [] }), { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "10" } });
  if (!liveResponse.ok) return commentResponse("reconnecting", cursor);
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
    commentsResponse = await fetch(commentsUrl, { headers: { Authorization: `Bearer ${env.FACEBOOK_PAGE_ACCESS_TOKEN}` } });
  } catch {
    return commentResponse("reconnecting", cursor);
  }
  if (commentsResponse.status === 401 || commentsResponse.status === 403) return commentResponse("auth_failed", cursor);
  if (commentsResponse.status === 429) return new Response(JSON.stringify({ state: "rate_limited", cursor, pollAfterMs: 10_000, comments: [] }), { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "10" } });
  if (!commentsResponse.ok) return commentResponse("reconnecting", cursor);
  try {
    const normalized = normalizeGraphComments(await commentsResponse.json(), cursor);
    return commentResponse("ok", normalized.cursor, normalized.comments, COMMENT_POLL_AFTER_MS, true);
  } catch {
    return commentResponse("reconnecting", cursor);
  }
}

/**
 * Authenticates a Chase operator through Supabase and its existing active-profile policy.
 * During the signed migration window the pre-auth Chase token remains accepted so installed
 * field clients never lose a working uplink; it is not returned to authenticated clients.
 */
type ChaseCaller = { operatorName?: string; vehicleName?: string };

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

async function authorizeCaller(request: Request, env: Env): Promise<ChaseCaller | null> {
  // Legacy field installs remain usable during migration, but cannot claim a user identity.
  if (legacyAuthorized(request, env.CHASE_TOKEN)) return {};
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
          operatorName: displayNameFromProfile(profile.operator_name) ?? displayNameFromProfileEmail(profile.email),
          vehicleName: vehicleNameFromProfile(profile.vehicle_id),
        }
      : null
  } catch {
    return null
  }
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
    return forwardFacebookComments(url, env);
  }

  if (!env.CORE_VPC) return json(503, { error: "CORE_UNAVAILABLE" });

  if (url.pathname === "/api/chase/mesonet/ota/check" ||
      /^\/api\/chase\/mesonet\/ota\/image\/(wind|weather)\/\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(url.pathname)) {
    if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json(401, { error: "AUTH_REQUIRED" });
    const path = url.pathname.replace("/api/chase/mesonet/ota", "/api/mesonet/v1/ota");
    try {
      const upstream = await env.CORE_VPC.fetch(`${CORE_ORIGIN}${path}${url.search}`, {
        headers: { Authorization: authorization },
      });
      const headers = new Headers(upstream.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch { return json(502, { error: "CORE_TRANSPORT_UNAVAILABLE" }); }
  }

  if (url.pathname === "/api/chase/mesonet/ingest") {
    if (request.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
    if (!request.headers.get("Authorization")?.startsWith("Bearer ")) {
      return json(401, { error: "AUTH_REQUIRED" });
    }
    const length = Number(request.headers.get("Content-Length") || "0");
    if (length > 4096) return json(413, { error: "PAYLOAD_TOO_LARGE" });
    const body = await request.arrayBuffer();
    if (body.byteLength > 4096) return json(413, { error: "PAYLOAD_TOO_LARGE" });
    try {
      // Core checks the distinct node credential and assigns its Fabric identity.
      return await env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/mesonet/v1/ingest`, {
        method: "POST", body,
        headers: { Authorization: request.headers.get("Authorization")!,
                   "Content-Type": "application/json" },
      });
    } catch { return json(502, { error: "CORE_TRANSPORT_UNAVAILABLE" }); }
  }

  if (url.pathname === "/api/chase/mesonet/public") {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
    if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
    if (!env.MESONET_READ_TOKEN) return json(503, { error: "NOT_CONFIGURED" });
    try {
      const upstream = await env.CORE_VPC.fetch(`${CORE_ORIGIN}/api/mesonet/v1/latest`, {
        headers: { Authorization: `Bearer ${env.MESONET_READ_TOKEN}` },
      });
      if (!upstream.ok) return json(503, { error: "READINGS_UNAVAILABLE" });
      const state = await upstream.json() as Record<string, {
        readings?: Record<string, number | null>; calibration_verified?: boolean;
      }>;
      const wind = state.wind?.readings ?? {}, weather = state.weather?.readings ?? {};
      // Fixed public fields: no location, IDs, credentials, or raw node metadata.
      return new Response(JSON.stringify({
        temperature_c: weather.temperature_c ?? null,
        humidity_pct: weather.humidity_pct ?? null,
        dewpoint_c: weather.dewpoint_c ?? null,
        wind_mps: state.wind?.calibration_verified ? wind.wind_mps ?? null : null,
        wind_avg_mps: state.wind?.calibration_verified ? wind.wind_avg_mps ?? null : null,
        gust_mps: state.wind?.calibration_verified ? wind.gust_mps ?? null : null,
        wind_calibration_verified: state.wind?.calibration_verified === true,
        wind_reference: "apparent", generated_at: new Date().toISOString(),
      }), { headers: { ...PUBLIC_CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    } catch { return json(502, { error: "CORE_TRANSPORT_UNAVAILABLE" }); }
  }

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
