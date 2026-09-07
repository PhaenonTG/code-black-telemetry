// Pure helpers for the /api/core/* Cloudflare Pages Function gateway. Kept dependency-free
// (only fetch/Response/URL, all standard) so this file can be unit tested directly with Vitest
// under Node, without needing the Workers runtime.

export interface GatewayEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  // Server-side only. Never VITE_-prefixed -- must never be inlined into the browser bundle.
  // Intentionally unset in production until a reviewed Core-side private transport exists; see
  // docs/system/code-black-core-gateway.md. While unset, every route below reports
  // CORE_UNAVAILABLE honestly instead of guessing at an upstream.
  CORE_GATEWAY_UPSTREAM_BASE?: string;
  // Optional defense-in-depth header sent to the upstream transport. Never sent to the browser.
  // Superseded by the Cloudflare Access Service Token pair below when both are configured --
  // Access validates at Cloudflare's edge before the request ever reaches the tunnel, which is
  // strictly stronger than a header Core-side code would have to check itself. Kept as a fallback
  // for a plain shared-secret-header tunnel setup if Access is not used.
  CORE_GATEWAY_SHARED_SECRET?: string;
  // Cloudflare Access Service Token credentials, if the tunnel hostname is protected by a Zero
  // Trust Access application + service-token policy (the platform-native, recommended option --
  // see docs/system/code-black-core-gateway.md). Cloudflare's edge rejects the request before it
  // reaches the tunnel/Core if these are absent or wrong; Core itself needs no new code either way.
  CORE_GATEWAY_CF_ACCESS_CLIENT_ID?: string;
  CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET?: string;
}

export interface AllowlistRoute {
  upstreamPath: string;
  allowedQueryParams: string[];
}

// Hardcoded allowlist. This is the entire set of paths this gateway will ever forward --
// there is no passthrough, no wildcard, no caller-controlled upstream host or path. Adding a
// route here is a reviewed code change, not a runtime configuration option.
//
// Route keys are the exact suffix src/core/client.ts appends to config.coreBaseUrl (e.g.
// `${coreBaseUrl}/api/fabric/v1/health`) -- deliberately matching Core's own real paths 1:1
// rather than a shorter alias. client.ts is shared with the local dev SSH-tunnel path, where
// coreBaseUrl points straight at Core with no gateway in front, so it always sends Core's actual
// paths; keeping the gateway's keys identical means this same client code needs no
// gateway-vs-direct branching and both paths were verified live against production.
export const CORE_GATEWAY_ALLOWLIST: Record<string, AllowlistRoute> = {
  "health": { upstreamPath: "/health", allowedQueryParams: [] },
  "api/fabric/v1/health": { upstreamPath: "/api/fabric/v1/health", allowedQueryParams: [] },
  "api/fabric/v1/units": { upstreamPath: "/api/fabric/v1/units", allowedQueryParams: [] },
  "api/storm-intel/v1/health": { upstreamPath: "/api/storm-intel/v1/health", allowedQueryParams: [] },
  "api/storm-intel/v1/point": { upstreamPath: "/api/storm-intel/v1/point", allowedQueryParams: ["latitude", "longitude"] },
};

export function normalizeRouteKey(path: string | string[] | undefined): string {
  const segments = Array.isArray(path) ? path : path ? [path] : [];
  return segments.map((segment) => segment.trim()).filter(Boolean).join("/");
}

export function resolveAllowlistRoute(routeKey: string): AllowlistRoute | null {
  return CORE_GATEWAY_ALLOWLIST[routeKey] ?? null;
}

export type GatewayErrorReason =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "UNAUTHORIZED"
  | "AUTH_PROVIDER_UNAVAILABLE"
  | "ROUTE_NOT_ALLOWED"
  | "METHOD_NOT_ALLOWED"
  | "CORE_UNAVAILABLE"
  | "CORE_TIMEOUT"
  | "CORE_MALFORMED_RESPONSE"
  | "GATEWAY_MISCONFIGURED";

export interface GatewayErrorBody {
  error: GatewayErrorReason;
}

export function gatewayErrorResponse(status: number, reason: GatewayErrorReason): Response {
  const body: GatewayErrorBody = { error: reason };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export type AuthResult = { ok: true; userId: string } | { ok: false; status: number; reason: GatewayErrorReason };

// Delegates verification to Supabase itself rather than locally verifying the JWT. This avoids
// holding a JWT signing secret or JWKS cache in the gateway, and it naturally honors revocation
// and expiry since Supabase is asked live on every request -- no locally-cached "valid" verdict
// can go stale. The publishable key used here is the same non-secret key already shipped to the
// browser (see web/ops/docs/ARCHITECTURE.md); nothing new or secret is introduced by this call.
export async function verifyOpsAuth(
  authorizationHeader: string | null,
  env: GatewayEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthResult> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, reason: "AUTH_REQUIRED" };
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, status: 401, reason: "AUTH_REQUIRED" };

  const supabaseUrl = env.VITE_SUPABASE_URL;
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return { ok: false, status: 500, reason: "GATEWAY_MISCONFIGURED" };
  }

  let userResponse: Response;
  try {
    userResponse = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: publishableKey },
    });
  } catch {
    return { ok: false, status: 502, reason: "AUTH_PROVIDER_UNAVAILABLE" };
  }
  if (!userResponse.ok) return { ok: false, status: 401, reason: "AUTH_INVALID" };

  const user = (await userResponse.json().catch(() => null)) as { id?: string } | null;
  const userId = user?.id;
  if (!userId) return { ok: false, status: 401, reason: "AUTH_INVALID" };

  // Same authorization boundary the app itself already enforces (public.profiles, RLS
  // "select own row") -- reused here via the user's own bearer token, not a service_role key.
  let profileResponse: Response;
  try {
    profileResponse = await fetchImpl(
      `${supabaseUrl}/rest/v1/profiles?select=active&user_id=eq.${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${token}`, apikey: publishableKey } },
    );
  } catch {
    return { ok: false, status: 502, reason: "AUTH_PROVIDER_UNAVAILABLE" };
  }
  if (!profileResponse.ok) return { ok: false, status: 403, reason: "UNAUTHORIZED" };

  const rows = (await profileResponse.json().catch(() => null)) as Array<{ active?: boolean }> | null;
  if (!Array.isArray(rows) || rows.length === 0 || rows[0].active !== true) {
    return { ok: false, status: 403, reason: "UNAUTHORIZED" };
  }

  return { ok: true, userId };
}

const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_UPSTREAM_BODY_BYTES = 2_000_000;

export interface UpstreamResult {
  status: number;
  reason?: GatewayErrorReason;
  body?: unknown;
}

// Forwards to exactly one hardcoded-shape upstream URL (allowlisted path + allowlisted query
// params only). The upstream host itself comes only from server-side configuration -- never from
// the request -- so this cannot become an open relay regardless of what a caller sends.
export async function forwardToCore(
  route: AllowlistRoute,
  incomingUrl: URL,
  env: GatewayEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<UpstreamResult> {
  if (!env.CORE_GATEWAY_UPSTREAM_BASE) {
    return { status: 502, reason: "CORE_UNAVAILABLE" };
  }

  const upstreamUrl = new URL(route.upstreamPath, env.CORE_GATEWAY_UPSTREAM_BASE);
  for (const key of route.allowedQueryParams) {
    const value = incomingUrl.searchParams.get(key);
    if (value !== null) upstreamUrl.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (env.CORE_GATEWAY_CF_ACCESS_CLIENT_ID && env.CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET) {
      headers["CF-Access-Client-Id"] = env.CORE_GATEWAY_CF_ACCESS_CLIENT_ID;
      headers["CF-Access-Client-Secret"] = env.CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET;
    } else if (env.CORE_GATEWAY_SHARED_SECRET) {
      headers["X-Core-Gateway-Secret"] = env.CORE_GATEWAY_SHARED_SECRET;
    }

    const upstreamResponse = await fetchImpl(upstreamUrl.toString(), { signal: controller.signal, headers });

    const contentLength = upstreamResponse.headers.get("Content-Length");
    if (contentLength && Number(contentLength) > MAX_UPSTREAM_BODY_BYTES) {
      return { status: 502, reason: "CORE_MALFORMED_RESPONSE" };
    }

    const text = await upstreamResponse.text();
    if (text.length > MAX_UPSTREAM_BODY_BYTES) {
      return { status: 502, reason: "CORE_MALFORMED_RESPONSE" };
    }

    let parsed: unknown;
    try {
      parsed = text.length ? JSON.parse(text) : null;
    } catch {
      return { status: 502, reason: "CORE_MALFORMED_RESPONSE" };
    }

    if (!upstreamResponse.ok) {
      return { status: 502, reason: "CORE_UNAVAILABLE" };
    }
    return { status: 200, body: parsed };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return { status: 504, reason: timedOut ? "CORE_TIMEOUT" : "CORE_UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}
