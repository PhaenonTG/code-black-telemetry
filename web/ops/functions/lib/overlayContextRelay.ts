import { forwardToCore, type GatewayEnv } from "./coreGateway";

export const OVERLAY_CONTEXT_PATH = "/overlay-core/overlay-context/v1/nick";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const FABRIC_UNITS_ROUTE = { upstreamPath: "/api/fabric/v1/units", allowedQueryParams: [] };
const SPC_CACHE_MS = 10 * 60_000;
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const SPC_URLS = {
  day1Categorical: "https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson",
  day1Tornado: "https://www.spc.noaa.gov/products/outlook/day1otlk_torn.lyr.geojson",
  day2Categorical: "https://www.spc.noaa.gov/products/outlook/day2otlk_cat.lyr.geojson",
  day2Tornado: "https://www.spc.noaa.gov/products/outlook/day2otlk_torn.lyr.geojson",
};

type JsonRecord = Record<string, unknown>;
type Risk = { label: string; labelLong: string; color: string | null; issued: string | null; expires: string | null };
type ContextResponse = {
  available: boolean;
  generatedAt: string;
  forecast: { status: "available"; days: Array<{ date: string; high: number; low: number; precipitationProbability: number | null; weatherCode: number | null }> } | { status: "unavailable" };
  spc: { status: "available"; day1: { categorical: Risk | null; tornado: Risk | null }; day2: { categorical: Risk | null; tornado: Risk | null } } | { status: "unavailable" };
};

let spcCache: { expires: number; value: Record<string, unknown[]> } | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS } });
}

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function numberAt(value: unknown, index: number): number | null {
  const candidate = Array.isArray(value) ? value[index] : null;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}
function readCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function resolveFabricLocation(snapshot: unknown): { latitude: number; longitude: number } | null {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.units)) return null;
  const unit = snapshot.units.find((candidate) => isRecord(candidate) && candidate.unit_id === "cbwx-unit-tessa");
  if (!isRecord(unit) || !Array.isArray(unit.devices)) return null;
  const devices = unit.devices.filter(isRecord).filter((device) => device.health_state === "LIVE" || device.health_state === "DEGRADED");
  devices.sort((a, b) => Date.parse(String(b.last_seen ?? "")) - Date.parse(String(a.last_seen ?? "")));
  for (const device of devices) {
    const latest = isRecord(device.latest) ? device.latest : {};
    const nested = isRecord(latest.location) ? latest.location : {};
    const latitude = readCoordinate(latest.lat) ?? readCoordinate(nested.lat) ?? readCoordinate(nested.latitude);
    const longitude = readCoordinate(latest.lon) ?? readCoordinate(nested.lon) ?? readCoordinate(nested.longitude);
    if (latitude !== null && longitude !== null) return { latitude, longitude };
  }
  return null;
}

function pointInRing(latitude: number, longitude: number, ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    const xi = Number(a[0]), yi = Number(a[1]), xj = Number(b[0]), yj = Number(b[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const crosses = (yi > latitude) !== (yj > latitude) && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi || 1e-9) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
function pointInGeometry(latitude: number, longitude: number, geometry: unknown): boolean {
  if (!isRecord(geometry)) return false;
  const containsPolygon = (rings: unknown): boolean => Array.isArray(rings) && pointInRing(latitude, longitude, rings[0]) && !rings.slice(1).some((hole) => pointInRing(latitude, longitude, hole));
  if (geometry.type === "Polygon") return containsPolygon(geometry.coordinates);
  return geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates) && geometry.coordinates.some(containsPolygon);
}
function highestRisk(features: unknown[], latitude: number, longitude: number): Risk | null {
  let best: { rank: number; risk: Risk } | null = null;
  for (const feature of features) {
    if (!isRecord(feature) || !pointInGeometry(latitude, longitude, feature.geometry)) continue;
    const props = isRecord(feature.properties) ? feature.properties : {};
    const rank = Number(props.DN ?? 0);
    if (!Number.isFinite(rank) || rank <= 0 || (best && rank <= best.rank)) continue;
    best = { rank, risk: { label: String(props.LABEL ?? ""), labelLong: String(props.LABEL2 ?? props.LABEL ?? ""), color: typeof props.fill === "string" ? props.fill : typeof props.stroke === "string" ? props.stroke : null, issued: typeof props.ISSUE_ISO === "string" ? props.ISSUE_ISO : typeof props.ISSUE === "string" ? props.ISSUE : null, expires: typeof props.EXPIRE_ISO === "string" ? props.EXPIRE_ISO : typeof props.EXPIRE === "string" ? props.EXPIRE : null } };
  }
  return best?.risk ?? null;
}
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}
async function loadSpc(): Promise<Record<string, unknown[]>> {
  if (spcCache && spcCache.expires > Date.now()) return spcCache.value;
  const entries = await Promise.all(Object.entries(SPC_URLS).map(async ([key, url]) => {
    const body = await fetchJson(url);
    return [key, isRecord(body) && Array.isArray(body.features) ? body.features : []] as const;
  }));
  const value = Object.fromEntries(entries);
  spcCache = { expires: Date.now() + SPC_CACHE_MS, value };
  return value;
}
async function loadForecast(latitude: number, longitude: number): Promise<ContextResponse["forecast"]> {
  const url = new URL(OPEN_METEO_URL);
  url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), daily: "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max", temperature_unit: "fahrenheit", timezone: "auto", forecast_days: "3" }).toString();
  const body = await fetchJson(url.toString());
  const daily = isRecord(body) && isRecord(body.daily) ? body.daily : null;
  if (!daily || !Array.isArray(daily.time)) throw new Error("forecast daily series unavailable");
  const days = daily.time.map((date, index) => {
    const high = numberAt(daily.temperature_2m_max, index), low = numberAt(daily.temperature_2m_min, index);
    if (typeof date !== "string" || high === null || low === null) throw new Error("forecast daily series malformed");
    return { date, high: Math.round(high), low: Math.round(low), precipitationProbability: numberAt(daily.precipitation_probability_max, index), weatherCode: numberAt(daily.weathercode, index) };
  });
  return { status: "available", days };
}

export async function handleOverlayContextRequest(request: Request, env: GatewayEnv): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const core = await forwardToCore(FABRIC_UNITS_ROUTE, new URL(request.url), env);
  const location = core.status === 200 ? resolveFabricLocation(core.body) : null;
  if (!location) return json({ available: false, generatedAt: new Date().toISOString(), reason: "FABRIC_LOCATION_UNAVAILABLE", forecast: { status: "unavailable" }, spc: { status: "unavailable" } });

  const [forecastResult, spcResult] = await Promise.allSettled([loadForecast(location.latitude, location.longitude), loadSpc()]);
  const response: ContextResponse = {
    available: true,
    generatedAt: new Date().toISOString(),
    forecast: forecastResult.status === "fulfilled" ? forecastResult.value : { status: "unavailable" },
    spc: spcResult.status === "fulfilled"
      ? { status: "available", day1: { categorical: highestRisk(spcResult.value.day1Categorical, location.latitude, location.longitude), tornado: highestRisk(spcResult.value.day1Tornado, location.latitude, location.longitude) }, day2: { categorical: highestRisk(spcResult.value.day2Categorical, location.latitude, location.longitude), tornado: highestRisk(spcResult.value.day2Tornado, location.latitude, location.longitude) } }
      : { status: "unavailable" },
  };
  return json(response);
}

export function clearOverlayContextCacheForTests(): void { spcCache = null; }
