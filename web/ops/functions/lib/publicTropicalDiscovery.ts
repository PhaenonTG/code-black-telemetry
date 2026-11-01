/** Public, bounded NHC discovery index. Never expose Core's raw history. */
import { forwardToCore, type GatewayEnv } from "./coreGateway";

export const PUBLIC_TROPICAL_DISCOVERY_PATH = "/api/public/tropical-discovery";
const CORE_ROUTE = { upstreamPath: "/api/forecast/v1/tropical-discovery", allowedQueryParams: [] };
const ORIGINS = new Set(["https://tropics.codeblackwx.com", "https://codeblack-hurricane.pages.dev"]);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown, max = 120): string | null => typeof value === "string" ? value.slice(0, max) : null;
const date = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value.slice(0, 40) : null;
const chance = (value: unknown): number | null => {
  const percent = object(value).percent;
  return typeof percent === "number" && Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : null;
};
const official = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.nhc.noaa.gov" ? url.toString() : null; }
  catch { return null; }
};

export function toPublicTropicalDiscovery(input: unknown) {
  const source = object(input);
  const active_storms = rows(source.active_storms).slice(0, 30).map((entry) => {
    const storm = object(entry);
    return {
      id: str(storm.id, 16), name: str(storm.name, 80), basin: str(storm.basin, 30),
      classification: str(storm.classification, 12), intensity_kt: typeof storm.intensity_kt === "number" ? storm.intensity_kt : null,
      pressure_mb: typeof storm.pressure_mb === "number" ? storm.pressure_mb : null,
      last_update: date(storm.last_update), freshness: storm.freshness === "current" ? "current" : "stale",
      advisory_url: official(storm.advisory_url), discussion_url: official(storm.discussion_url),
    };
  }).filter((storm) => /^(al|ep|cp)\d{6}$/i.test(storm.id ?? ""));
  const outlook_areas = rows(source.outlook_areas).slice(0, 30).map((entry) => {
    const area = object(entry), formation = object(area.formation_chance);
    return {
      key: str(area.key, 140), basin: str(area.basin, 30), title: str(area.title, 100),
      invest_id: str(area.invest_id, 16), issued_at: date(area.issued_at), source_url: official(area.source_url),
      chance_48h: chance(formation["48_hours"]), chance_7d: chance(formation["7_days"]),
      kind: "nhc_development_outlook_area_not_a_forecast_track" as const,
    };
  }).filter((area) => area.key && area.title);
  return {
    schema: "codeblack.tropics.public-discovery.v1", status: source.status === "ready" ? "ready" : source.status === "pending" ? "pending" : "stale",
    freshness: source.freshness === "current" ? "current" : "stale", checked_at: date(source.checked_at),
    source_times: Object.fromEntries(["atlantic", "eastern_pacific", "central_pacific"].map((basin) => [basin, date(object(source.source_times)[basin])])),
    active_storms, outlook_areas,
  };
}

export async function handlePublicTropicalDiscovery(request: Request, env: GatewayEnv, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = origin && ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "Content-Type": "application/json", ...cors } });
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request("https://ops.codeblackwx.com/api/public/tropical-discovery");
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers), ...cors } });
  const result = await forwardToCore(CORE_ROUTE, new URL(request.url), env);
  if (result.status !== 200) return new Response(JSON.stringify({ error: "DATA_UNAVAILABLE" }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });
  const safe = new Response(JSON.stringify(toPublicTropicalDiscovery(result.body)), { status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=30, s-maxage=60", "X-Content-Type-Options": "nosniff" } });
  if (cache) ctx?.waitUntil(cache.put(cacheKey, safe.clone()));
  return new Response(safe.body, { status: 200, headers: { ...Object.fromEntries(safe.headers), ...cors } });
}
