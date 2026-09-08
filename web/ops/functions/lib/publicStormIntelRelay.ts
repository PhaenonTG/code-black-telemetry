// Public (no Supabase OPS session) relay for the Storm Intel v1 REST route a broadcast overlay
// needs. Mirrors ardotCameraRelay.ts's pattern -- a plain importable module wired directly into
// worker/entry.ts's own fetch handler (Advanced Mode never routes to functions/api/*.ts
// folder-convention Functions; see the comment atop worker/entry.ts).
//
// Why this exists instead of just using /api/core/*: that gateway requires a signed-in OPS
// user's Supabase session (verifyOpsAuth), which a headless OBS browser source has no way to
// obtain -- there's no login UI running in a stream overlay. This relay is deliberately narrower
// in what it exposes to make going auth-free safe:
//   - Only the point (lat/lon) Storm Intel context, never a unit-context route. A unit's fleet
//     ID (cbwx-unit-*) is never accepted as input here and never appears in any response --
//     matching the existing "Public Overlay Boundary" the overlay's own publicIdentity.ts
//     already enforces client-side. This relay enforces the same boundary server-side, which is
//     the boundary that actually matters.
//   - Only two fixed upstream paths (health/point), same hardcoded-allowlist shape as
//     CORE_GATEWAY_ALLOWLIST -- no passthrough, no caller-controlled upstream path.
//   - Reuses forwardToCore() itself (not a reimplementation) so this always uses whatever
//     transport is actually configured in production -- confirmed live that this account's
//     production only works via the CORE_GATEWAY_WORKER VPC Service Binding path; the
//     alternate "public fetch + CF-Access headers" branch forwardToCore also supports hits an
//     Access sign-in page instead of Core (that public tunnel hostname's Access policy no
//     longer honors the configured service-token headers, or was never meant to be reached
//     this way). Reusing forwardToCore means this relay automatically tracks whichever
//     transport is really live instead of guessing.
//
// No WebSocket relay yet: the VPC Service Binding Worker (workers/core-gateway/) only proxies
// the REST allowlist above, not a WS upgrade, and the public Access-tunnel path doesn't work at
// all right now (see above) -- so there is no live transport to relay a WS connection through
// today. web/overlay's RestStormIntelProvider was changed to poll this REST route on an
// interval instead of depending on WS for ongoing updates, so this gap doesn't leave the
// overlay stuck re-showing "connection lost" over real data. Revisit once/if a VPC-reachable WS
// transport exists.
import { forwardToCore, type GatewayEnv } from "./coreGateway";

export const OVERLAY_CORE_PREFIX = "/overlay-core";

const REST_ROUTES: Record<string, { upstreamPath: string; allowedQueryParams: string[] }> = {
  "/api/storm-intel/v1/health": { upstreamPath: "/api/storm-intel/v1/health", allowedQueryParams: [] },
  "/api/storm-intel/v1/point": { upstreamPath: "/api/storm-intel/v1/point", allowedQueryParams: ["latitude", "longitude"] },
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function handlePublicStormIntelRequest(request: Request, env: GatewayEnv): Promise<Response> {
  const url = new URL(request.url);
  const routePath = url.pathname.slice(OVERLAY_CORE_PREFIX.length);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const restRoute = REST_ROUTES[routePath];
  if (!restRoute) {
    return new Response(JSON.stringify({ error: "ROUTE_NOT_ALLOWED" }), {
      status: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    });
  }

  const result = await forwardToCore(restRoute, url, env);
  return new Response(JSON.stringify(result.status === 200 ? result.body : { error: result.reason ?? "CORE_UNAVAILABLE" }), {
    status: result.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}
