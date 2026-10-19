const TDOT_PREFIX = "/api/tdot/";
const TDOT_ORIGIN = "https://www.tdot.tn.gov/opendata/api/public/";
// TDOT publishes this client key in SmartWay's public config specifically for the open-data API.
const TDOT_PUBLIC_API_KEY = "8d3b7a82635d476795c09b2c41facc60";
const ALLOWED_ENDPOINTS = new Set([
  "RoadwayCameras",
  "RoadwayIncidents",
  "RoadwayOperations",
  "RoadwayWeather",
  "RoadwaySevereImpact",
]);

export function resolveTdotEndpoint(requestUrl: URL): URL | null {
  if (!requestUrl.pathname.startsWith(TDOT_PREFIX)) return null;
  const endpoint = requestUrl.pathname.slice(TDOT_PREFIX.length);
  if (!ALLOWED_ENDPOINTS.has(endpoint)) return null;
  return new URL(endpoint, TDOT_ORIGIN);
}

export async function handleTdotRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const upstream = resolveTdotEndpoint(new URL(request.url));
  if (!upstream) return Response.json({ error: "ROUTE_NOT_ALLOWED" }, { status: 404 });
  try {
    const response = await fetch(upstream, {
      headers: { Accept: "application/json", "X-API-Key": TDOT_PUBLIC_API_KEY },
      cf: { cacheTtl: 60, cacheEverything: true },
    } as RequestInit);
    if (!response.ok) return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
    return new Response(response.body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
  }
}

export { TDOT_PREFIX };
