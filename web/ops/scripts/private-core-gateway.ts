import { createHash, createHmac } from "node:crypto";
import { ARDOT_RELAY_PREFIX, handleArdotCameraStream } from "../functions/lib/ardotCameraRelay";
import { CAMERA_HEALTH_PATH, handleCameraHealth } from "../functions/lib/cameraHealthRelay";
import { KANDRIVE_PATH, handleKandriveRequest } from "../functions/lib/kandriveRelay";
import { MODOT_PREFIX, handleModotRequest } from "../functions/lib/modotRelay";
import { ODOT_PREFIX, handleOdotRequest } from "../functions/lib/odotRelay";
import { TDOT_PREFIX, handleTdotRequest } from "../functions/lib/tdotRelay";
import { privateProviderFetch } from "./private-provider-fetch";
import { handlePrivateProducerRead, type PrivateProducerEnv } from "./private-producer-gateway";
import {
  gatewayErrorResponse,
  resolveAllowlistRoute,
  verifyOpsAuth,
  type GatewayEnv,
} from "../functions/lib/coreGateway";

export interface PrivateCoreEnv extends GatewayEnv, PrivateProducerEnv {
  OPS_PRIVATE_CORE_BASE_URL?: string;
  OPS_PRIVATE_WRITE_SECRET?: string;
  MAPBOX_PUBLIC_TOKEN?: string;
  ODOT_WZDX_ACCESS_TOKEN?: string;
}

const prefix = "/api/core/";
const maxPostBytes = 4096;
const maxPutBytes = 64 * 1024;
const maxResponseBytes = 2_000_000;
const overlayPrefix = "/overlay-core";
const overlayCors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

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
    const maxWriteBytes = request.method === "PUT" ? maxPutBytes : maxPostBytes;
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

export async function handlePrivateOverlayRequest(
  request: Request,
  env: PrivateCoreEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${overlayPrefix}/`)) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: overlayCors });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
    status: 405, headers: { "Content-Type": "application/json", ...overlayCors },
  });
  if (url.pathname === "/overlay-core/mapbox-token") {
    return new Response(JSON.stringify(env.MAPBOX_PUBLIC_TOKEN ? { token: env.MAPBOX_PUBLIC_TOKEN } : { error: "MAPBOX_TOKEN_NOT_CONFIGURED" }), {
      status: env.MAPBOX_PUBLIC_TOKEN ? 200 : 503,
      headers: { "Content-Type": "application/json", "Cache-Control": env.MAPBOX_PUBLIC_TOKEN ? "public, max-age=3600" : "no-store", ...overlayCors },
    });
  }
  const path = url.pathname.slice(overlayPrefix.length);
  const params = path === "/api/storm-intel/v1/health" ? [] :
    path === "/api/storm-intel/v1/point" ? ["latitude", "longitude"] : null;
  if (!params) return new Response(JSON.stringify({ error: "ROUTE_NOT_ALLOWED" }), {
    status: 404, headers: { "Content-Type": "application/json", ...overlayCors },
  });
  const base = localCoreUrl(env.OPS_PRIVATE_CORE_BASE_URL);
  if (!base) return new Response(JSON.stringify({ error: "CORE_UNAVAILABLE" }), {
    status: 502, headers: { "Content-Type": "application/json", ...overlayCors },
  });
  const target = new URL(path, base);
  for (const key of params) {
    const value = url.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  try {
    const upstream = await fetchImpl(target, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(25_000) });
    if (!upstream.ok || Number(upstream.headers.get("Content-Length") ?? 0) > maxResponseBytes)
      throw new Error("Core unavailable");
    const text = await upstream.text();
    if (Buffer.byteLength(text) > maxResponseBytes) throw new Error("Core response too large");
    const body = JSON.parse(text);
    return new Response(JSON.stringify(body), { status: 200, headers: {
      "Content-Type": "application/json", "Cache-Control": "no-store", ...overlayCors,
    } });
  } catch {
    return new Response(JSON.stringify({ error: "CORE_UNAVAILABLE" }), {
      status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...overlayCors },
    });
  }
}

export function handlePrivateApiRequest(request: Request, env: PrivateCoreEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/core/")) return handlePrivateCoreRequest(request, env, fetchImpl);
  if (path.startsWith("/api/producer/v1/")) return handlePrivateProducerRead(request, env, fetchImpl);
  if (path.startsWith("/overlay-core/")) return handlePrivateOverlayRequest(request, env, fetchImpl);
  if (path === CAMERA_HEALTH_PATH) return handleCameraHealth(request);
  if (path === ARDOT_RELAY_PREFIX) return handleArdotCameraStream(request);
  if (path === KANDRIVE_PATH) return handleKandriveRequest(request, privateProviderFetch);
  if (path.startsWith(MODOT_PREFIX)) return handleModotRequest(request, privateProviderFetch);
  if (path.startsWith(ODOT_PREFIX)) return handleOdotRequest(request, env, privateProviderFetch);
  if (path.startsWith(TDOT_PREFIX)) return handleTdotRequest(request, privateProviderFetch);
  return Promise.resolve(gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED"));
}
