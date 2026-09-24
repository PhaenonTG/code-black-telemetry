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

/**
 * Authenticates a Chase operator through Supabase and its existing active-profile policy.
 * During the signed migration window the pre-auth Chase token remains accepted so installed
 * field clients never lose a working uplink; it is not returned to authenticated clients.
 */
async function authorized(request: Request, env: Env): Promise<boolean> {
  if (legacyAuthorized(request, env.CHASE_TOKEN)) return true
  const header = request.headers.get("Authorization") ?? ""
  if (!header.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return false
  const token = header.slice("Bearer ".length).trim()
  if (!token) return false
  const headers = { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_PUBLISHABLE_KEY }
  try {
    const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers })
    if (!userResponse.ok) return false
    const user = await userResponse.json() as { id?: string }
    if (!user.id) return false
    const profileResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/profiles?select=active&user_id=eq.${encodeURIComponent(user.id)}`,
      { headers },
    )
    if (!profileResponse.ok) return false
    const profiles = await profileResponse.json() as Array<{ active?: boolean }>
    return Array.isArray(profiles) && profiles.some((profile) => profile.active === true)
  } catch {
    return false
  }
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

async function forwardConfig(request: Request, env: Env): Promise<Response> {
  if (!env.CHASE_TOKEN) return json(503, { error: "CORE_UNAVAILABLE" });
  const response = await env.CORE_VPC!.fetch(`${CORE_ORIGIN}/api/chase/v1/config`, {
    headers: { Authorization: `Bearer ${env.CHASE_TOKEN}`, Accept: "application/json" },
  });
  // Configuration can contain temporary operational credentials. It must never be retained by
  // a browser, intermediary cache, or another client after this tightly scoped response.
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
const RELEASE_PREFIX = "/api/chase/v1/releases/";
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

async function handleUpdateRoute(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "METHOD_NOT_ALLOWED" });
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
  const fileName = url.pathname.slice(RELEASE_PREFIX.length);
  if (fileName !== releaseFileName(manifest.versionCode) || url.pathname !== `${RELEASE_PREFIX}${fileName}`) {
    return json(404, { error: "NOT_FOUND" });
  }
  const apk = await readAsset(env, `/${fileName}`);
  if (!apk) return json(404, { error: "NOT_FOUND" });
  const actual = await sha256Hex(apk);
  if (actual.toLowerCase() !== String(manifest.sha256).toLowerCase()) return json(409, { error: "CHECKSUM_MISMATCH" });
  return new Response(apk, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Cache-Control": "no-store",
      "Content-Length": String(apk.byteLength),
    },
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === UPDATE_PATH || url.pathname.startsWith(RELEASE_PREFIX)) {
    try {
      return await handleUpdateRoute(request, url, env);
    } catch {
      return json(500, { error: "UPDATE_UNAVAILABLE" });
    }
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

  if (!(await authorized(request, env))) return json(401, { error: "AUTH_REQUIRED" });

  try {
    if (url.pathname === CONFIG_PATH && request.method === "GET") {
      return await forwardConfig(request, env);
    }
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
