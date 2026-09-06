// Cloudflare Pages Function: authenticated, allowlisted, read-only gateway from
// ops.codeblackwx.com to CodeBlack-Core's private API. See
// docs/system/code-black-core-gateway.md for the full architecture and trust boundary.
//
// This is NOT an open proxy. The upstream host comes only from server-side configuration
// (CORE_GATEWAY_UPSTREAM_BASE), never from the request, and only the hardcoded paths in
// CORE_GATEWAY_ALLOWLIST are ever forwarded. Every request must carry a valid, active-profile
// Supabase OPS session -- there is no unauthenticated path through this Function.
import {
  type GatewayEnv,
  forwardToCore,
  gatewayErrorResponse,
  normalizeRouteKey,
  resolveAllowlistRoute,
  verifyOpsAuth,
} from "../../lib/coreGateway";

interface PagesContext {
  request: Request;
  params: { path?: string | string[] };
  env: GatewayEnv;
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const auth = await verifyOpsAuth(context.request.headers.get("Authorization"), context.env);
  if (!auth.ok) return gatewayErrorResponse(auth.status, auth.reason);

  const routeKey = normalizeRouteKey(context.params.path);
  const route = resolveAllowlistRoute(routeKey);
  if (!route) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");

  const incomingUrl = new URL(context.request.url);
  const result = await forwardToCore(route, incomingUrl, context.env);

  if (result.status !== 200) return gatewayErrorResponse(result.status, result.reason ?? "CORE_UNAVAILABLE");
  return new Response(JSON.stringify(result.body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Read-only gateway: every other method is explicitly rejected rather than silently ignored.
// There is no ingest/write/command/OTA path through this Function, by construction.
async function methodNotAllowed(): Promise<Response> {
  return gatewayErrorResponse(405, "METHOD_NOT_ALLOWED");
}

export const onRequestPost = methodNotAllowed;
export const onRequestPut = methodNotAllowed;
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
