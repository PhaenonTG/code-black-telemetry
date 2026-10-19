const MODOT_PREFIX = "/api/modot/";
const MODOT_ORIGIN = "https://mapping.modot.org/arcgis/rest/services/TravelerInformation/";
const ALLOWED_SERVICES = new Set(["NWSDATA", "TravelerInformationData"]);
const ALLOWED_QUERY = new Set([
  "f", "outFields", "geometry", "geometryType", "inSR", "spatialRel",
  "resultRecordCount", "where", "returnGeometry", "outSR",
]);

export function resolveModotUrl(requestUrl: URL): URL | null {
  if (!requestUrl.pathname.startsWith(MODOT_PREFIX)) return null;
  const parts = requestUrl.pathname.slice(MODOT_PREFIX.length).split("/").filter(Boolean);
  if (parts.length !== 4 || !ALLOWED_SERVICES.has(parts[0]) || parts[1] !== "MapServer" || !/^\d+$/.test(parts[2]) || parts[3] !== "query") return null;
  const upstream = new URL(`${parts[0]}/MapServer/${parts[2]}/query`, MODOT_ORIGIN);
  for (const [key, value] of requestUrl.searchParams) {
    if (ALLOWED_QUERY.has(key)) upstream.searchParams.set(key, value);
  }
  upstream.searchParams.set("f", "geojson");
  return upstream;
}

export async function handleModotRequest(request: Request): Promise<Response> {
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "Content-Type": "application/json" } });
  const upstream = resolveModotUrl(new URL(request.url));
  if (!upstream) return new Response(JSON.stringify({ error: "ROUTE_NOT_ALLOWED" }), { status: 404, headers: { "Content-Type": "application/json" } });
  try {
    const response = await fetch(upstream, { headers: { Accept: "application/geo+json, application/json" }, cf: { cacheTtl: 60, cacheEverything: true } } as RequestInit);
    if (!response.ok) return new Response(JSON.stringify({ error: "PROVIDER_UNAVAILABLE" }), { status: 502, headers: { "Content-Type": "application/json" } });
    return new Response(response.body, {
      status: 200,
      headers: { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "PROVIDER_UNAVAILABLE" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

export { MODOT_PREFIX };
