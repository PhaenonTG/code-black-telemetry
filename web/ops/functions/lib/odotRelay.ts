const ODOT_PREFIX = "/api/odot/";
const ODOT_ORIGIN = "https://oktraffic.org/api/Geojsons/";
const ALLOWED_FEEDS = new Set(["workzones", "closures"]);

interface OdotEnv { ODOT_WZDX_ACCESS_TOKEN?: string }
const USDOT_REGISTRY_URL = "https://data.transportation.gov/resource/69qe-yiui.json?$limit=500";

async function resolvePublicRegistryToken(): Promise<string | null> {
  try {
    const response = await fetch(USDOT_REGISTRY_URL, { headers: { Accept: "application/json" }, cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
    if (!response.ok) return null;
    const rows = await response.json() as Array<Record<string, unknown>>;
    const row = rows.find((item) => String(item.state).toLowerCase() === "oklahoma" && String(item.active).toLowerCase() !== "no");
    const rawUrl = row && typeof row.url === "object" && row.url ? String((row.url as Record<string, unknown>).url ?? "") : String(row?.url ?? "");
    return new URL(rawUrl).searchParams.get("access_token");
  } catch {
    return null;
  }
}

export function resolveOdotUrl(requestUrl: URL, token: string): URL | null {
  if (!requestUrl.pathname.startsWith(ODOT_PREFIX)) return null;
  const feed = requestUrl.pathname.slice(ODOT_PREFIX.length);
  if (!ALLOWED_FEEDS.has(feed)) return null;
  const upstream = new URL(feed, ODOT_ORIGIN);
  upstream.searchParams.set("access_token", token);
  return upstream;
}

export async function handleOdotRequest(request: Request, env: OdotEnv): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  // Prefer the configured binding, but fall back to USDOT's public registry so a new OPS install
  // does not require Nick (or any field tester) to provision a provider token by hand.
  const token = env.ODOT_WZDX_ACCESS_TOKEN || await resolvePublicRegistryToken();
  if (!token) return Response.json({ error: "PROVIDER_NOT_CONFIGURED" }, { status: 501 });
  const upstream = resolveOdotUrl(new URL(request.url), token);
  if (!upstream) return Response.json({ error: "ROUTE_NOT_ALLOWED" }, { status: 404 });
  try {
    const response = await fetch(upstream, { headers: { Accept: "application/json" }, cf: { cacheTtl: 60, cacheEverything: true } } as RequestInit);
    if (!response.ok) return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
    return new Response(response.body, { status: 200, headers: { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "PROVIDER_UNAVAILABLE" }, { status: 502 });
  }
}

export { ODOT_PREFIX, type OdotEnv };
