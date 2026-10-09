/** Public-only hurricane feed. Never forward the private OPS snapshot verbatim. */
import { forwardToCore, type GatewayEnv } from "./coreGateway";

export const PUBLIC_HURRICANE_PATH = "/api/public/hurricane";
const CORE_ROUTE = { upstreamPath: "/api/forecast/v1/hurricane-watch", allowedQueryParams: [] };
const MODEL_IDS = new Set(["HFAI", "HFBI", "AVNI"]);
const PUBLIC_ORIGINS = new Set([
  "https://hurricane.codeblackwx.com",
  "https://storms.codeblackwx.com",
  "https://codeblack-hurricane.pages.dev",
]);

type Dict = Record<string, unknown>;
type Position = { latitude: number; longitude: number };
const object = (value: unknown): Dict => value && typeof value === "object" && !Array.isArray(value) ? value as Dict : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const number = (value: unknown): number | null => {
  const result = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(result) ? result : null;
};
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const officialUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["www.nhc.noaa.gov", "www.weather.gov", "api.weather.gov"].includes(url.hostname) ? url.toString() : null;
  } catch { return null; }
};
const point = (value: unknown): Position | null => {
  const row = object(value), latitude = number(row.latitude), longitude = number(row.longitude);
  return latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
};
const trackPoint = (value: unknown) => {
  const row = object(value), coordinates = point(row), hour = number(row.hour);
  if (!coordinates || hour === null || hour < 0 || hour > 120) return null;
  return { ...coordinates, hour, valid_time: string(row.valid_time), wind_mph: number(row.wind_mph) };
};
const haversineMiles = (a: Position, b: Position) => {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians, dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.76 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

function positionAt(points: ReturnType<typeof trackPoint>[], validMs: number): Position | null {
  const valid = points.filter((entry): entry is NonNullable<typeof entry> => !!entry && !!entry.valid_time)
    .map((entry) => ({ ...entry, ms: Date.parse(entry.valid_time!) })).filter((entry) => Number.isFinite(entry.ms)).sort((a, b) => a.ms - b.ms);
  const exact = valid.find((entry) => entry.ms === validMs);
  if (exact) return { latitude: exact.latitude, longitude: exact.longitude };
  const upperIndex = valid.findIndex((entry) => entry.ms > validMs);
  if (upperIndex <= 0) return null;
  const lower = valid[upperIndex - 1], upper = valid[upperIndex];
  if (upper.ms - lower.ms > 24 * 3600_000) return null;
  const fraction = (validMs - lower.ms) / (upper.ms - lower.ms);
  return { latitude: lower.latitude + (upper.latitude - lower.latitude) * fraction,
    longitude: lower.longitude + (upper.longitude - lower.longitude) * fraction };
}

/** Equal-weight independent-aid centroid; consensus aids are deliberately excluded. */
export function deriveProjection(models: unknown[], latestCycle: unknown) {
  const cycle = string(latestCycle), start = cycle ? Date.parse(cycle) : NaN;
  if (!Number.isFinite(start)) return { status: "unavailable", points: [], method: "Equal-weight HAFS-A, HAFS-B and GFS center-track blend" };
  const members = models.map(object).filter((model) => MODEL_IDS.has(String(model.id)) && Array.isArray(model.points))
    .map((model) => ({ id: String(model.id), cycle: string(model.cycle), points: array(model.points).map(trackPoint) }));
  const points = [];
  for (const hour of [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 84, 96, 108, 120]) {
    const validMs = start + hour * 3600_000;
    const positions = members.map((model) => positionAt(model.points, validMs)).filter((item): item is Position => !!item);
    if (positions.length < 2) continue;
    const latitude = positions.reduce((sum, item) => sum + item.latitude, 0) / positions.length;
    const longitude = positions.reduce((sum, item) => sum + item.longitude, 0) / positions.length;
    let spread = 0;
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      spread = Math.max(spread, haversineMiles(positions[i], positions[j]));
    }
    points.push({ hour, valid_time: new Date(validMs).toISOString(), latitude: +latitude.toFixed(3), longitude: +longitude.toFixed(3),
      spread_miles: Math.round(spread), members: positions.length });
  }
  return { status: points.length >= 3 ? "ready" : "unavailable", points: points.length >= 3 ? points : [],
    cycle, method: "Equal-weight geographic blend of independent HAFS-A, HAFS-B and GFS center tracks; requires at least two members at each valid time. Not calibrated or official.",
    member_ids: members.map((model) => model.id) };
}

export function toPublicHurricane(raw: unknown) {
  const data = object(raw), storm = object(data.storm), guidance = object(data.model_guidance), trend = object(data.observed_trend);
  const models = array(guidance.models).map(object).filter((model) => ["HFAI", "HFBI", "AVNI", "HCCA", "TVCN"].includes(String(model.id)))
    .map((model) => ({ id: model.id, name: string(model.name), cycle: string(model.cycle),
      points: array(model.points).map(trackPoint).filter(Boolean), shift_48h_miles: number(model.shift_48h_miles) }));
  const projection = deriveProjection(array(guidance.models), guidance.latest_cycle);
  const officialTrack = array(data.track).map(trackPoint).filter(Boolean);
  const observed = array(data.observed_track).map((entry) => {
    const row = object(entry), coordinates = point(row);
    return coordinates ? { ...coordinates, valid_time: string(row.valid_time), wind_mph: number(row.wind_mph), pressure_mb: number(row.pressure_mb) } : null;
  }).filter(Boolean);
  const alerts = array(data.coastal_context_alerts).map((entry) => {
    const row = object(entry);
    return { event: string(row.event), headline: string(row.headline), severity: string(row.severity), expires: string(row.expires), url: officialUrl(row.url) };
  });
  const advisory = object(storm.publicAdvisory), discussion = object(storm.forecastDiscussion);
  return {
    status: string(data.status) ?? "unavailable", checked_at: string(data.checked_at), freshness: string(data.freshness),
    storm: { id: string(storm.id), name: string(storm.name), classification: string(storm.classification), intensity: string(storm.intensity),
      pressure_mb: number(storm.pressure), center: { latitude: number(storm.latitudeNumeric), longitude: number(storm.longitudeNumeric) },
      movement_degrees: number(storm.movementDir), movement_mph: number(storm.movementSpeed), last_update: string(storm.lastUpdate) },
    official: { track: officialTrack, cone: array(data.cone).filter((entry) => Array.isArray(entry) && entry.length >= 2 && number(entry[0]) !== null && number(entry[1]) !== null).map((entry) => [Number((entry as number[])[0]), Number((entry as number[])[1])]),
      cone_status: string(data.cone_status), advisory_url: officialUrl(advisory.url), discussion_url: officialUrl(discussion.url) },
    projection, guidance: { status: string(guidance.status), latest_cycle: string(guidance.latest_cycle), models,
      spread_48h_miles: number(guidance.spread_48h_miles), wind_48h_mph_range: Array.isArray(guidance.wind_48h_mph_range) ? guidance.wind_48h_mph_range.map(number) : null },
    observed: { track: observed, trend: { period_hours: number(trend.period_hours), wind_change_mph: number(trend.wind_change_mph), pressure_change_mb: number(trend.pressure_change_mb) } },
    regional_alerts: alerts, regional_alerts_status: string(data.coastal_context_status),
    disclosure: "Aegis projection is an experimental blend of model center tracks, not an official NHC forecast or impact prediction. Use NHC, NWS, and local officials for decisions.",
  };
}

export async function handlePublicHurricane(request: Request, env: GatewayEnv, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = origin && PUBLIC_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "Content-Type": "application/json", ...cors } });
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request("https://ops.codeblackwx.com/api/public/hurricane");
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers), ...cors } });
  const result = await forwardToCore(CORE_ROUTE, new URL(request.url), env);
  if (result.status !== 200) return new Response(JSON.stringify({ error: "DATA_UNAVAILABLE" }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });
  const safe = new Response(JSON.stringify(toPublicHurricane(result.body)), { status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=300", "X-Content-Type-Options": "nosniff" } });
  if (cache) ctx?.waitUntil(cache.put(cacheKey, safe.clone()));
  return new Response(safe.body, { status: 200, headers: { ...Object.fromEntries(safe.headers), ...cors } });
}
