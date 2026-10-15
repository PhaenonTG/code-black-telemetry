import { createHash, createHmac } from "node:crypto";
import {
  gatewayErrorResponse,
  resolveAllowlistRoute,
  verifyOpsAuth,
  type GatewayEnv,
} from "../functions/lib/coreGateway";

export interface PrivateCoreEnv extends GatewayEnv {
  OPS_PRIVATE_CORE_BASE_URL?: string;
  OPS_PRIVATE_WRITE_SECRET?: string;
}

const prefix = "/api/core/";
const maxWriteBytes = 4096;
const maxResponseBytes = 2_000_000;

function localCoreUrl(base: string | undefined): URL | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    return url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

function signedActorHeaders(path: string, body: string, actor: string, role: string, secret: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hash = createHash("sha256").update(body).digest("hex");
  const message = ["POST", path, timestamp, actor, role, hash].join("\n");
  return {
    "X-Ops-User-Id": actor,
    "X-Ops-Role": role,
    "X-Ops-Timestamp": timestamp,
    "X-Ops-Signature": createHmac("sha256", secret).update(message).digest("hex"),
  };
}

export async function handlePrivateCoreRequest(
  request: Request,
  env: PrivateCoreEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const auth = await verifyOpsAuth(request.headers.get("Authorization"), env, fetchImpl);
  if (!auth.ok) return gatewayErrorResponse(auth.status, auth.reason);

  const incomingUrl = new URL(request.url);
  if (!incomingUrl.pathname.startsWith(prefix)) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");
  const key = incomingUrl.pathname.slice(prefix.length);
  const route = resolveAllowlistRoute(key);
  if (!route) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");
  if (!(route.methods ?? ["GET"]).includes(request.method)) return gatewayErrorResponse(405, "METHOD_NOT_ALLOWED");
  if (route.opsWrite && (!auth.role || (route.opsWrite === "decision" && !["OWNER", "ADMIN"].includes(auth.role))))
    return gatewayErrorResponse(403, "UNAUTHORIZED");

  const base = localCoreUrl(env.OPS_PRIVATE_CORE_BASE_URL);
  if (!base) return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  const target = new URL(route.upstreamPath, base);
  for (const param of route.allowedQueryParams) {
    const value = incomingUrl.searchParams.get(param);
    if (value !== null) target.searchParams.set(param, value);
  }

  let body: string | undefined;
  if (request.method === "POST" || request.method === "PUT") {
    if (Number(request.headers.get("Content-Length") ?? 0) > maxWriteBytes)
      return gatewayErrorResponse(413, "REQUEST_TOO_LARGE");
    body = await request.text();
    if (Buffer.byteLength(body) > maxWriteBytes) return gatewayErrorResponse(413, "REQUEST_TOO_LARGE");
  }
  if (route.opsWrite && !env.OPS_PRIVATE_WRITE_SECRET) return gatewayErrorResponse(502, "CORE_UNAVAILABLE");

  const headers: Record<string, string> = {
    Accept: route.upstreamPath === "/api/fabric/v1/stream" ? "application/x-ndjson" : "application/json",
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(route.opsWrite ? signedActorHeaders(route.upstreamPath, body ?? "", auth.userId, auth.role!, env.OPS_PRIVATE_WRITE_SECRET!) : {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), route.upstreamPath === "/api/fabric/v1/stream" ? 120_000 : 25_000);
  try {
    const upstream = await fetchImpl(target, { method: request.method, body, headers, signal: controller.signal, redirect: "manual" });
    if (route.upstreamPath === "/api/fabric/v1/stream") {
      if (!upstream.ok || !upstream.body || !upstream.headers.get("Content-Type")?.startsWith("application/x-ndjson")) {
        await upstream.body?.cancel();
        return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
      }
      return new Response(upstream.body, { status: 200, headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform",
      } });
    }
    const length = Number(upstream.headers.get("Content-Length") ?? 0);
    if (length > maxResponseBytes) return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
    const text = await upstream.text();
    if (Buffer.byteLength(text) > maxResponseBytes) return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : null; }
    catch { return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE"); }
    if (route.upstreamPath === "/api/soundings/v1/search-location" && upstream.status === 404)
      return gatewayErrorResponse(404, "LOCATION_NOT_FOUND");
    if (!upstream.ok) {
      if (route.opsWrite && [403, 409, 422].includes(upstream.status)) {
        const error = upstream.status === 409 ? "SETUP_CONFLICT" : upstream.status === 403 ? "UNAUTHORIZED" : "INVALID_REQUEST";
        return new Response(JSON.stringify({ error }), { status: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
      return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    return gatewayErrorResponse(error instanceof DOMException && error.name === "AbortError" ? 504 : 502,
      error instanceof DOMException && error.name === "AbortError" ? "CORE_TIMEOUT" : "CORE_UNAVAILABLE");
  } finally { clearTimeout(timer); }
}
