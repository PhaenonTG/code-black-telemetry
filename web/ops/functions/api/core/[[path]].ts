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
import { normalizeLocalReviewRequest } from "../../lib/localReviewRequest";

interface PagesContext {
  request: Request;
  params: { path?: string | string[] };
  env: GatewayEnv;
}

function traceId(request: Request): string {
  const supplied = request.headers.get("X-CodeBlack-Trace-Id") ?? "";
  return /^[A-Za-z0-9_-]{8,96}$/.test(supplied) ? supplied : `ops-${crypto.randomUUID()}`;
}

async function proxy(context: PagesContext, method: "GET" | "POST" | "PUT"): Promise<Response> {
  const auth = await verifyOpsAuth(context.request.headers.get("Authorization"), context.env);
  if (!auth.ok) return gatewayErrorResponse(auth.status, auth.reason);

  const routeKey = normalizeRouteKey(context.params.path);
  const route = resolveAllowlistRoute(routeKey);
  if (!route) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");
  if (!(route.methods ?? ["GET"]).includes(method)) return gatewayErrorResponse(405, "METHOD_NOT_ALLOWED");

  const id = traceId(context.request);
  const init: RequestInit = { method, headers: { "X-CodeBlack-Trace-Id": id } };
  if (method === "POST" || method === "PUT") {
    let text = await context.request.text();
    if (text.length > 16_000) return gatewayErrorResponse(413, "CORE_MALFORMED_RESPONSE");
    const review = normalizeLocalReviewRequest(route.upstreamPath, text);
    if (review && !review.ok) return gatewayErrorResponse(review.status, "INVALID_REVIEW_BODY");
    if (review?.ok) text = review.body;
    init.body = text;
    init.headers = { ...init.headers, "Content-Type": "application/json" };
  }
  const result = await forwardToCore(route, new URL(context.request.url), context.env, fetch, init);
  if (result.status !== 200) return gatewayErrorResponse(result.status, result.reason ?? "CORE_UNAVAILABLE");
  return new Response(JSON.stringify(result.body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-CodeBlack-Trace-Id": result.traceId ?? id },
  });
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  return proxy(context, "GET");
}

// Only the explicitly listed GET/POST operations above; no generic write/command relay.
async function methodNotAllowed(): Promise<Response> {
  return gatewayErrorResponse(405, "METHOD_NOT_ALLOWED");
}

export async function onRequestPost(context: PagesContext): Promise<Response> { return proxy(context, "POST"); }
export async function onRequestPut(context: PagesContext): Promise<Response> { return proxy(context, "PUT"); }
export const onRequestPatch = methodNotAllowed;
export const onRequestDelete = methodNotAllowed;
