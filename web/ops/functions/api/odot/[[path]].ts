// Cloudflare Pages Function: same-origin proxy for ODOT's public WZDx feed (oktraffic.org).
//
// oktraffic.org returns no Access-Control-Allow-Origin for arbitrary origins (confirmed via direct
// request), so the browser blocks a direct client fetch. This relays the request server-to-server,
// where CORS doesn't apply, and adds an open Access-Control-Allow-Origin for the response.
//
// The access token is read from the ODOT_WZDX_ACCESS_TOKEN environment variable (set in Cloudflare
// Pages project settings, both Production and Preview) rather than hardcoded here. It is the one
// embedded in ODOT's own registered public feed URL in USDOT's national WZDx Feed Registry -- a
// per-feed identifier the registry itself publishes for third-party consumption, not a private
// secret -- but it still doesn't belong committed in source. Upstream host and allowed feed paths
// are both fixed, not caller-controlled, so this cannot be used as an open relay to arbitrary hosts.
const ODOT_UPSTREAM_BASE = "https://oktraffic.org/api/Geojsons";
const ALLOWED_FEEDS = new Set(["workzones", "closures"]);

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

interface PagesContext {
  request: Request;
  params: { path?: string | string[] };
  env: { ODOT_WZDX_ACCESS_TOKEN?: string };
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const segments = Array.isArray(context.params.path) ? context.params.path : context.params.path ? [context.params.path] : [];
  const feed = segments[0];
  if (!feed || !ALLOWED_FEEDS.has(feed)) {
    return new Response(JSON.stringify({ error: "Unknown ODOT feed" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  const token = context.env.ODOT_WZDX_ACCESS_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: "ODOT_WZDX_ACCESS_TOKEN not configured" }), {
      status: 501,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  const upstreamUrl = `${ODOT_UPSTREAM_BASE}/${feed}?access_token=${encodeURIComponent(token)}`;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, { headers: { Accept: "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: "ODOT upstream request failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const body = await upstreamResponse.text();
  return new Response(body, {
    status: upstreamResponse.status,
    headers: {
      "Content-Type": upstreamResponse.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "public, max-age=30",
      ...CORS_HEADERS,
    },
  });
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
