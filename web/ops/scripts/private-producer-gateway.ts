import { createHash, timingSafeEqual } from "node:crypto";
import { gatewayErrorResponse, verifyOpsAuth, type GatewayEnv } from "../functions/lib/coreGateway";

export interface PrivateProducerEnv extends GatewayEnv {
  OPS_PRIVATE_PRODUCER_BASE_URL?: string;
  OPS_PRIVATE_PRODUCER_TOKEN?: string;
}

const prefix = "/api/producer/v1/";
const segment = /^preview\/hls\/program-[0-9a-f]{32}-[0-9]{1,16}\.ts$/;
const workstationPrefix = "/api/producer/v1/workstation/";
const workstationSegment = /^preview\/hls\/program-[0-9a-f]{32}-[0-9]{1,16}\.ts$/;

function ingestRoute(path: string): { type: string; limit: number } | null {
  if (path === "status" || path === "capabilities") return { type: "application/json", limit: 64 * 1024 };
  if (path === "preview/program.jpg") return { type: "image/jpeg", limit: 2 * 1024 * 1024 };
  if (path === "preview/hls/index.m3u8") return { type: "application/vnd.apple.mpegurl", limit: 64 * 1024 };
  if (workstationSegment.test(path)) return { type: "video/mp2t", limit: 512 * 1024 };
  return null;
}

function validIngestToken(header: string | null, token: string | undefined): boolean {
  if (!token || token.length < 32 || !header?.startsWith("Bearer ")) return false;
  const supplied = createHash("sha256").update(header.slice(7)).digest();
  const expected = createHash("sha256").update(token).digest();
  return timingSafeEqual(supplied, expected);
}

function route(path: string): { type: string; limit: number } | null {
  if (path === "status" || path === "capabilities") return { type: "application/json", limit: 64 * 1024 };
  if (path === "preview/program.jpg") return { type: "image/jpeg", limit: 2 * 1024 * 1024 };
  if (path === "preview/hls/index.m3u8") return { type: "application/vnd.apple.mpegurl", limit: 64 * 1024 };
  if (segment.test(path)) return { type: "video/mp2t", limit: 512 * 1024 };
  return null;
}

function localProducerUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url : null;
  } catch { return null; }
}

export async function handlePrivateProducerWrite(
  request: Request,
  env: PrivateProducerEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const allowed = request.method === "POST" && path.startsWith(workstationPrefix)
    ? ingestRoute(path.slice(workstationPrefix.length)) : null;
  if (!allowed) return gatewayErrorResponse(503, "SHADOW_READ_ONLY");
  if (!validIngestToken(request.headers.get("Authorization"), env.OPS_PRIVATE_PRODUCER_TOKEN))
    return gatewayErrorResponse(401, "AUTH_REQUIRED");
  const base = localProducerUrl(env.OPS_PRIVATE_PRODUCER_BASE_URL);
  if (!base) return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== allowed.type)
    return gatewayErrorResponse(415, "UNSUPPORTED_MEDIA_TYPE");
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > allowed.limit) return gatewayErrorResponse(413, "REQUEST_TOO_LARGE");
  const headers = new Headers({ Authorization: `Bearer ${env.OPS_PRIVATE_PRODUCER_TOKEN}`, "Content-Type": allowed.type });
  for (const name of ["X-Producer-Frame-At", "X-Producer-Composition"]) {
    const value = request.headers.get(name);
    if (value && /^[\x20-\x7e]{1,256}$/.test(value)) headers.set(name, value);
  }
  try {
    const upstream = await fetchImpl(new URL(path, base), {
      method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(5_000),
    });
    await upstream.body?.cancel();
    if (upstream.ok) return Response.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
    return gatewayErrorResponse(upstream.status === 413 ? 413 : 502,
      upstream.status === 413 ? "REQUEST_TOO_LARGE" : "CORE_UNAVAILABLE");
  } catch {
    return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  }
}

async function boundedBody(response: Response, limit: number): Promise<Uint8Array | null> {
  const length = response.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export async function handlePrivateProducerRead(
  request: Request,
  env: PrivateProducerEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return gatewayErrorResponse(404, "ROUTE_NOT_ALLOWED");
  const allowed = request.method === "GET" ? route(url.pathname.slice(prefix.length)) : null;
  if (!allowed) return new Response(JSON.stringify({ error: "SHADOW_READ_ONLY" }), {
    status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

  const auth = await verifyOpsAuth(request.headers.get("Authorization"), env, fetchImpl);
  if (!auth.ok) return gatewayErrorResponse(auth.status, auth.reason);
  const base = localProducerUrl(env.OPS_PRIVATE_PRODUCER_BASE_URL);
  const token = env.OPS_PRIVATE_PRODUCER_TOKEN;
  if (!base || !token || token.length < 32) return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  const target = new URL(url.pathname, base);
  try {
    const upstream = await fetchImpl(target, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: allowed.type },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return gatewayErrorResponse(upstream.status === 404 ? 404 : 502,
        upstream.status === 404 ? "ROUTE_NOT_ALLOWED" : "CORE_UNAVAILABLE");
    }
    const contentType = upstream.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== allowed.type) {
      await upstream.body?.cancel();
      return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
    }
    const bytes = await boundedBody(upstream, allowed.limit);
    if (!bytes) return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
    if (allowed.type === "application/json") {
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE"); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return gatewayErrorResponse(502, "CORE_MALFORMED_RESPONSE");
      if (url.pathname === `${prefix}status`) {
        payload = { ...payload, controlAccess: { allowed: false, userId: auth.userId }, controlLease: null };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: {
        "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      } });
    }
    const headers = new Headers({ "Content-Type": allowed.type, "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff" });
    if (["image/jpeg", "application/vnd.apple.mpegurl", "video/mp2t"].includes(allowed.type)) {
      for (const name of ["X-Producer-Frame-At", "X-Producer-Composition"]) {
        const value = upstream.headers.get(name);
        if (value && /^[\x20-\x7e]{1,256}$/.test(value)) headers.set(name, value);
      }
    }
    return new Response(bytes, { status: 200, headers });
  } catch {
    return gatewayErrorResponse(502, "CORE_UNAVAILABLE");
  }
}
