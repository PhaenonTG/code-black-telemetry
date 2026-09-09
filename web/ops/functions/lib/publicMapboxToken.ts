// Public (no Supabase OPS session) endpoint that hands back the project's Mapbox public token,
// so classic.html (a static page, no build step, no server-side templating of its own) never
// needs the token pasted into its own URL or baked into its own source.
//
// Why this exists instead of just embedding the token in classic.html: it's a real pk. public
// token, the same one used everywhere else in this project (VITE_MAPBOX_ACCESS_TOKEN) -- Mapbox's
// own client-side model is BUILT around this kind of token being visible in a page's own source/
// network traffic, that part is normal and not a leak. The actual problem GitHub's push
// protection caught was narrower: this token sitting as plaintext in *git history* on a scanned
// repo can be scraped by bots that specifically hunt commit history for exactly this pattern,
// independent of whether the live site ever runs. Keeping it only in Cloudflare's own secret
// store (never committed) closes that specific hole without changing how exposed it is to an
// actual page visitor, which was never really the concern.
import type { GatewayEnv } from "./coreGateway";

export const MAPBOX_TOKEN_PATH = "/overlay-core/mapbox-token";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export interface MapboxTokenEnv extends GatewayEnv {
  MAPBOX_PUBLIC_TOKEN?: string;
}

export async function handleMapboxTokenRequest(
  request: Request,
  env: MapboxTokenEnv,
  ctx?: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  if (!env.MAPBOX_PUBLIC_TOKEN) {
    return new Response(JSON.stringify({ error: "MAPBOX_TOKEN_NOT_CONFIGURED" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS },
    });
  }

  // A bare Cache-Control header on a Worker-generated response only governs the requesting
  // browser's own cache -- it does NOT get pulled into Cloudflare's edge cache by itself, so
  // every page load was still invoking this Worker despite the header saying max-age=3600.
  // Explicitly using the Cache API is what actually keeps this off the edge's request count;
  // same fix as radar-relay's tile/frame caching. `caches` is a Workers-runtime global, absent
  // under any Node-based test run, so this degrades to a plain no-op there instead of throwing.
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = cache ? new Request(new URL(request.url).toString(), request) : null;
  if (cache) {
    const cached = await cache.match(cacheKey!);
    if (cached) return cached;
  }

  const response = new Response(JSON.stringify({ token: env.MAPBOX_PUBLIC_TOKEN }), {
    status: 200,
    // Token only ever changes on a deliberate rotation, not per-request -- a long TTL here is a
    // pure win, not a freshness tradeoff.
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...CORS_HEADERS },
  });
  if (cache) ctx?.waitUntil(cache.put(cacheKey!, response.clone()));
  return response;
}
