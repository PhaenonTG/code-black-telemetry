// Public relay for radar-worker (NEXRAD Level II/III single-site radar -- reflectivity,
// velocity, storm-relative velocity, correlation coefficient; tiles + frame/site metadata).
// No auth, unlike the Core/chase relays: radar-worker's own data is public NOAA NEXRAD data
// pulled from public S3 buckets, so there's no secret here to protect by gating this route --
// this Worker exists only to give a plain HTTP-on-a-private-host service a real public URL.
//
// radar-worker itself already fetched with { host: "0.0.0.0" } listening publicly on its own
// port and set CORS headers on every response (see worker.cjs's send() helper) -- this relay
// changes none of that; it forwards the request/response through the VPC Service pretty much
// byte-for-byte, including binary PNG tile bodies (returned as the raw upstream body, never
// buffered/re-encoded, so tiles stay correct and this stays cheap to run per-request).
const RADAR_ORIGIN = "http://127.0.0.1:8787";
const PREFIX = "/api/v1/radar/";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) {
    return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (!env.RADAR_VPC) {
    return new Response(JSON.stringify({ error: "RADAR_UNAVAILABLE" }), {
      status: 503,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const target = new URL(url.pathname + url.search, RADAR_ORIGIN);
  try {
    const init = { method: request.method, headers: { Accept: request.headers.get("Accept") ?? "*/*" } };
    if (request.method === "POST") {
      init.headers["Content-Type"] = request.headers.get("Content-Type") ?? "application/json";
      init.body = await request.text();
    }
    const upstream = await env.RADAR_VPC.fetch(target.toString(), init);
    const headers = new Headers(upstream.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response(JSON.stringify({ error: "RADAR_TRANSPORT_UNAVAILABLE" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}

export default { fetch: handleRequest };
