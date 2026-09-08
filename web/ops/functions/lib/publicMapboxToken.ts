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

export async function handleMapboxTokenRequest(request: Request, env: MapboxTokenEnv): Promise<Response> {
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
  return new Response(JSON.stringify({ token: env.MAPBOX_PUBLIC_TOKEN }), {
    status: 200,
    // Cached at the edge for a while -- this value only ever changes on a deliberate token
    // rotation, not per-request, so there's no reason to hit the Worker for every page load.
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...CORS_HEADERS },
  });
}
