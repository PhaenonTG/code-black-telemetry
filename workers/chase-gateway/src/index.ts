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

const PUBLIC_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const PUBLIC_UNIT_ID = "cbwx-unit-tessa";
const PUBLIC_FRESH_MS = 15_000;

export interface VpcServiceBinding {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  CORE_VPC?: VpcServiceBinding;
  // Shared bearer secret. Checked against the caller's `Authorization: Bearer <token>` header on
  // every authenticated route, and injected server-side (never exposed) on the public route.
  CHASE_TOKEN?: string;
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

function authorized(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = request.headers.get("Authorization") || "";
  return header === `Bearer ${expected}`;
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

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (!env.CORE_VPC) return json(503, { error: "CORE_UNAVAILABLE" });

  const url = new URL(request.url);

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

  if (!authorized(request, env.CHASE_TOKEN)) return json(401, { error: "AUTH_REQUIRED" });

  try {
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
