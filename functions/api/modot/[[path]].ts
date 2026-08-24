// Cloudflare Pages Function: same-origin proxy for MoDOT's public ArcGIS Server REST services.
//
// mapping.modot.org only reflects Access-Control-Allow-Origin for MoDOT's own domains (confirmed
// via direct request), so the browser blocks a direct client fetch. This relays the request
// server-to-server, where CORS doesn't apply, and adds an open Access-Control-Allow-Origin so the
// deployed web/ops app can read the response. Upstream host is fixed and not caller-controlled --
// only the ArcGIS service path and query string are forwarded -- so this cannot be used as an
// open relay to arbitrary hosts.
const MODOT_UPSTREAM_BASE = "https://mapping.modot.org/arcgis/rest/services/TravelerInformation";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

interface PagesContext {
  request: Request;
  params: { path?: string | string[] };
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const segments = Array.isArray(context.params.path) ? context.params.path : context.params.path ? [context.params.path] : [];
  const incoming = new URL(context.request.url);
  const upstreamUrl = `${MODOT_UPSTREAM_BASE}/${segments.map(encodeURIComponent).join("/")}${incoming.search}`;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, { headers: { Accept: "application/json, application/geo+json" } });
  } catch {
    return new Response(JSON.stringify({ error: "MoDOT upstream request failed" }), {
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
