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
//
// Edge caching: tiles/frames/sites are identical for every viewer at a given moment -- they
// aren't per-user data -- but nothing was using Cloudflare's edge cache, so every open OBS
// instance, browser tab, or ops dashboard independently re-invoked this Worker (and radar-worker
// behind it) for the exact same bytes. That's what was actually driving the request count up,
// not any single viewer. Explicitly using the Cache API means the first request for a given
// tile/frame-list/site-list pays the real cost once; every other simultaneous viewer within the
// TTL gets served straight from Cloudflare's edge with zero additional Worker invocations.
const RADAR_ORIGIN = "http://127.0.0.1:8787";
const PREFIX = "/api/v1/radar/";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Tiles are content-addressed by frameId -- a given tile's bytes never change once radar-worker
// has rendered them, so caching them is a pure win, not a freshness tradeoff. A new NEXRAD
// volume scan lands roughly every 5 minutes at best, sometimes 30-35 -- 30 minutes here is
// comfortably inside that window (a stale-but-still-valid tile just means a slightly outdated
// scan for the last few seconds of its life, never wrong data, since the URL itself changes
// once a newer frameId exists). Frame/site listings do change over time (a new scan landing, a
// moved chase position), so they keep a short-ish TTL -- 20s is still nowhere near fast enough
// to delay "is there a new frame yet" in any way that matters against a 5+ minute real cadence,
// but it's long enough to collapse a burst of simultaneous viewers into one origin request.
function cacheTtlSeconds(pathname) {
  if (pathname.includes("/tiles/")) return 1800;
  if (pathname.includes("/frames") || pathname.includes("/sites/")) return 20;
  return 0;
}

export async function handleRequest(request, env, ctx) {
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

  // `caches` is a Workers-runtime global -- absent under Node (e.g. this file's own test
  // suite), so cache participation degrades to a no-op there instead of throwing.
  const ttl = request.method === "GET" ? cacheTtlSeconds(url.pathname) : 0;
  const cache = ttl > 0 && typeof caches !== "undefined" ? caches.default : null;
  // Cache key ignores nothing from the URL (query string included, e.g. ?site=&product=) since
  // that's exactly what distinguishes one tile/frame-list from another.
  const cacheKey = cache ? new Request(url.toString(), request) : null;

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
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

    if (cache && upstream.ok) headers.set("Cache-Control", `public, max-age=${ttl}`);

    const response = new Response(upstream.body, { status: upstream.status, headers });

    if (cache && upstream.ok) {
      // Cache API needs the body readable twice -- put a clone in the cache, return the original.
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  } catch {
    return new Response(JSON.stringify({ error: "RADAR_TRANSPORT_UNAVAILABLE" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}

export default { fetch: handleRequest };
