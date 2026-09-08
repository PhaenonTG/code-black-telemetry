// Cloudflare Pages "Advanced Mode" worker entry (_worker.js after bundling). Runs before any
// static-asset lookup, unconditionally, on every request -- see docs/system/code-black-core-gateway.md
// for why this exists.
//
// Production diagnosis (Stage 3): the folder-based Pages Functions convention
// (functions/api/core/[[path]].ts) builds and deploys correctly, but this project runs on
// Cloudflare's newer unified assets/Worker serving engine (Build System v3), where static-asset
// resolution -- including the SPA not-found fallback -- runs BEFORE a folder-based Function by
// default, and neither an explicit _routes.json include list nor a pages_build_output_dir-style
// wrangler.jsonc with assets.run_worker_first reliably overrides that for this project (the
// latter's build silently never started, likely a beta-feature validation gap). Advanced Mode
// sidesteps the ambiguity entirely: a _worker.js in the build output has ALWAYS meant "this
// script decides everything, including when to fall back to static assets" for any request that
// actually reaches it.
//
// That caveat is real, not rhetorical: public/_routes.json still gates which requests reach this
// file at all (an include-list Pages applies regardless of Advanced Mode) -- a path added below
// without also adding it there silently falls straight to static-asset/SPA-fallback serving, no
// error, no log, just the app shell coming back instead of this handler ever running. Confirmed
// the hard way once already (the ARDOT camera relay below sat unreachable in production until its
// path was added to that include-list). Every route this file handles needs an entry there too.
//
// This is NOT an open proxy. The upstream host comes only from server-side configuration
// (CORE_GATEWAY_UPSTREAM_BASE), never from the request, and only the hardcoded paths in
// CORE_GATEWAY_ALLOWLIST are ever forwarded. Every /api/core/* request must carry a valid,
// active-profile Supabase OPS session -- there is no unauthenticated path through this gateway.
// Everything else falls straight through to the same static assets/SPA behavior the site always
// had.
import {
  type GatewayEnv,
  forwardToCore,
  gatewayErrorResponse,
  normalizeRouteKey,
  resolveAllowlistRoute,
  verifyOpsAuth,
} from "../functions/lib/coreGateway";
import { ARDOT_RELAY_PREFIX, handleArdotCameraStream } from "../functions/lib/ardotCameraRelay";

interface Env extends GatewayEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const GATEWAY_PREFIX = "/api/core/";

async function handleGatewayRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return gatewayErrorResponse(405, "METHOD_NOT_ALLOWED");
  }

  const auth = await verifyOpsAuth(request.headers.get("Authorization"), env);
  if (!auth.ok) return gatewayErrorResponse(auth.status, auth.reason);

  const url = new URL(request.url);
  const routeKey = normalizeRouteKey(url.pathname.slice(GATEWAY_PREFIX.length).split("/"));
  const route = resolveAllowlistRoute(routeKey);
  if (!route) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");

  const result = await forwardToCore(route, url, env);
  if (result.status !== 200) return gatewayErrorResponse(result.status, result.reason ?? "CORE_UNAVAILABLE");
  return new Response(JSON.stringify(result.body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(GATEWAY_PREFIX)) {
      return handleGatewayRequest(request, env);
    }
    if (url.pathname === ARDOT_RELAY_PREFIX) {
      return handleArdotCameraStream(request);
    }
    // Every other path: identical behavior to before this file existed -- static assets, with
    // the project's usual SPA not-found fallback for client-side routes.
    return env.ASSETS.fetch(request);
  },
};
