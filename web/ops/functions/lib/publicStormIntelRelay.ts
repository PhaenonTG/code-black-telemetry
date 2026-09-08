// Public (no Supabase OPS session) relay for the Storm Intel v1 REST + WebSocket routes a
// broadcast overlay needs. Mirrors ardotCameraRelay.ts's pattern -- a plain importable module
// wired directly into worker/entry.ts's own fetch handler (Advanced Mode never routes to
// functions/api/*.ts folder-convention Functions; see the comment atop worker/entry.ts).
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
//   - Only three fixed upstream paths (health/point/ws), same hardcoded-allowlist shape as
//     CORE_GATEWAY_ALLOWLIST -- no passthrough, no caller-controlled upstream path.
//   - Same upstream transport/credentials (CORE_GATEWAY_UPSTREAM_BASE + CF Access service token
//     or shared secret) as the authenticated gateway -- this relay narrows what a caller can
//     reach, it does not add a new hole to Core.
import type { GatewayEnv } from "./coreGateway";

export const OVERLAY_CORE_PREFIX = "/overlay-core";

const REST_ROUTES: Record<string, { upstreamPath: string; allowedQueryParams: string[] }> = {
  "/api/storm-intel/v1/health": { upstreamPath: "/api/storm-intel/v1/health", allowedQueryParams: [] },
  "/api/storm-intel/v1/point": { upstreamPath: "/api/storm-intel/v1/point", allowedQueryParams: ["latitude", "longitude"] },
};

const WS_PATH = "/api/storm-intel/v1/ws";
const WS_ALLOWED_QUERY_PARAMS = ["latitude", "longitude", "poll_seconds"];

const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_UPSTREAM_BODY_BYTES = 2_000_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function upstreamAuthHeaders(env: GatewayEnv): Record<string, string> {
  if (env.CORE_GATEWAY_CF_ACCESS_CLIENT_ID && env.CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET) {
    return {
      "CF-Access-Client-Id": env.CORE_GATEWAY_CF_ACCESS_CLIENT_ID,
      "CF-Access-Client-Secret": env.CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET,
    };
  }
  if (env.CORE_GATEWAY_SHARED_SECRET) {
    return { "X-Core-Gateway-Secret": env.CORE_GATEWAY_SHARED_SECRET };
  }
  return {};
}

async function handleRest(
  route: { upstreamPath: string; allowedQueryParams: string[] },
  incomingUrl: URL,
  env: GatewayEnv,
): Promise<Response> {
  if (!env.CORE_GATEWAY_UPSTREAM_BASE) {
    return new Response(JSON.stringify({ error: "CORE_UNAVAILABLE" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    });
  }

  const upstreamUrl = new URL(route.upstreamPath, env.CORE_GATEWAY_UPSTREAM_BASE);
  for (const key of route.allowedQueryParams) {
    const value = incomingUrl.searchParams.get(key);
    if (value !== null) upstreamUrl.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json", ...upstreamAuthHeaders(env) },
    });

    const text = await upstreamResponse.text();
    if (text.length > MAX_UPSTREAM_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "CORE_MALFORMED_RESPONSE" }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
      });
    }
    if (!upstreamResponse.ok) {
      return new Response(JSON.stringify({ error: "CORE_UNAVAILABLE" }), {
        status: 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
      });
    }
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return new Response(JSON.stringify({ error: timedOut ? "CORE_TIMEOUT" : "CORE_UNAVAILABLE" }), {
      status: 504,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    });
  } finally {
    clearTimeout(timer);
  }
}

function upstreamWsBase(env: GatewayEnv): string | null {
  const base = env.CORE_GATEWAY_UPSTREAM_BASE;
  if (!base) return null;
  if (base.startsWith("https://")) return `wss://${base.slice("https://".length)}`;
  if (base.startsWith("http://")) return `ws://${base.slice("http://".length)}`;
  return null;
}

// Cloudflare Workers proxy an outbound WebSocket by issuing a normal fetch() carrying the
// Upgrade header and reading back `response.webSocket` -- there is no separate WS-specific
// fetch API. The client-facing half is a WebSocketPair: the `[0]` end goes back to the browser
// in this Response, the `[1]` end is what this function reads/writes, wired to the upstream
// socket's own message/close events. Neither side re-frames or inspects message content --
// pure byte/text passthrough, same as the browser<->Core connection would be without this relay.
async function handleWebSocket(incomingUrl: URL, request: Request, env: GatewayEnv): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426, headers: CORS_HEADERS });
  }
  const wsBase = upstreamWsBase(env);
  if (!wsBase) {
    return new Response("Core unavailable", { status: 502, headers: CORS_HEADERS });
  }

  const upstreamUrl = new URL(WS_PATH, wsBase);
  for (const key of WS_ALLOWED_QUERY_PARAMS) {
    const value = incomingUrl.searchParams.get(key);
    if (value !== null) upstreamUrl.searchParams.set(key, value);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: { Upgrade: "websocket", ...upstreamAuthHeaders(env) },
    });
  } catch {
    return new Response("Core unreachable", { status: 502, headers: CORS_HEADERS });
  }

  const upstreamSocket = upstreamResponse.webSocket;
  if (!upstreamSocket) {
    return new Response("Core did not upgrade", { status: 502, headers: CORS_HEADERS });
  }

  const pair = new WebSocketPair();
  const [clientSocket, serverSocket] = Object.values(pair) as [WebSocket, WebSocket];

  serverSocket.accept();
  upstreamSocket.accept();

  serverSocket.addEventListener("message", (event) => {
    try {
      upstreamSocket.send(event.data);
    } catch {
      // Upstream already closed -- let its own close handler below tear the client side down.
    }
  });
  upstreamSocket.addEventListener("message", (event) => {
    try {
      serverSocket.send(event.data);
    } catch {
      // Client already closed -- nothing to relay to.
    }
  });

  const closeBoth = (code?: number, reason?: string) => {
    try {
      serverSocket.close(code, reason);
    } catch {
      // already closed
    }
    try {
      upstreamSocket.close(code, reason);
    } catch {
      // already closed
    }
  };
  serverSocket.addEventListener("close", (event) => closeBoth(event.code, event.reason));
  serverSocket.addEventListener("error", () => closeBoth());
  upstreamSocket.addEventListener("close", (event) => closeBoth(event.code, event.reason));
  upstreamSocket.addEventListener("error", () => closeBoth());

  return new Response(null, { status: 101, webSocket: clientSocket });
}

export async function handlePublicStormIntelRequest(request: Request, env: GatewayEnv): Promise<Response> {
  const url = new URL(request.url);
  const routePath = url.pathname.slice(OVERLAY_CORE_PREFIX.length);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (routePath === WS_PATH) {
    return handleWebSocket(url, request, env);
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
  return handleRest(restRoute, url, env);
}
