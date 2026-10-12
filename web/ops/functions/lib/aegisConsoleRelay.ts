import type { GatewayEnv } from "./coreGateway";

export const AEGIS_CONSOLE_PREFIX = "/ai";
const CORE_AEGIS_CONSOLE_PREFIX = "/api/ops/v1/aegis-console";
const MAX_REQUEST_BYTES = 2_000_000;

function unavailable(): Response {
  return new Response("AEGIS_CONSOLE_UNAVAILABLE", {
    status: 502,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Auth is deliberately performed by the existing AEGIS `/ai/auth/session`
 * exchange.  This worker only gives that already-authenticated console an OPS
 * origin; it never exposes PHAENON3's Tailscale hostname to a browser.
 */
export async function handleAegisConsoleRequest(
  request: Request,
  env: GatewayEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!env.CORE_GATEWAY_UPSTREAM_BASE) return unavailable();
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith(AEGIS_CONSOLE_PREFIX)) return new Response("NOT_FOUND", { status: 404 });
  const suffix = incoming.pathname.slice(AEGIS_CONSOLE_PREFIX.length).replace(/^\/+/, "");
  if (suffix.split("/").some((part) => part === "." || part === "..")) return new Response("INVALID_PATH", { status: 400 });

  const upstream = new URL(`${CORE_AEGIS_CONSOLE_PREFIX}/${suffix}`, env.CORE_GATEWAY_UPSTREAM_BASE);
  upstream.search = incoming.search;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > MAX_REQUEST_BYTES) return new Response("REQUEST_TOO_LARGE", { status: 413 });

  const headers = new Headers();
  for (const name of ["accept", "authorization", "content-type", "cookie", "user-agent", "x-requested-with"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (env.CORE_GATEWAY_CF_ACCESS_CLIENT_ID && env.CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET) {
    headers.set("CF-Access-Client-Id", env.CORE_GATEWAY_CF_ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", env.CORE_GATEWAY_CF_ACCESS_CLIENT_SECRET);
  } else if (env.CORE_GATEWAY_SHARED_SECRET) {
    headers.set("X-Core-Gateway-Secret", env.CORE_GATEWAY_SHARED_SECRET);
  }

  try {
    const response = await fetchImpl(upstream, { method: request.method, headers, body });
    const returned = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["cache-control", "content-language", "content-type", "etag", "last-modified", "location"]) {
      const value = response.headers.get(name);
      if (value) returned.set(name, value);
    }
    const cookie = response.headers.get("set-cookie");
    if (cookie) returned.append("set-cookie", cookie);
    return new Response(response.body, { status: response.status, headers: returned });
  } catch {
    return unavailable();
  }
}
