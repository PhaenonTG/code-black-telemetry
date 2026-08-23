import type { LayerQueryContext, ObservationProvenance, RoadClosureState, RoadConditionEvent, RoadConditionKind, RoadEventSeverity, RoadTravelDirection, TrafficCamera, TrafficCameraAvailability, ViewportLayerResult } from "./mapLayerModels";
import type { MapViewport } from "../map/viewport";

export interface ProviderCoverage {
  north: number;
  south: number;
  east: number;
  west: number;
  label: string;
}

export interface RoadConditionProvider {
  id: string;
  name: string;
  coverage: ProviderCoverage;
  enabled: boolean;
  priority: number;
  minRefreshMs: number;
  timeoutMs: number;
  attribution: string;
  fetchViewport(context: LayerQueryContext, signal?: AbortSignal): Promise<RoadConditionEvent[]>;
}

export interface TrafficCameraProvider {
  id: string;
  name: string;
  coverage: ProviderCoverage;
  enabled: boolean;
  priority: number;
  minRefreshMs: number;
  timeoutMs: number;
  attribution: string;
  fetchViewport(context: LayerQueryContext, signal?: AbortSignal): Promise<TrafficCamera[]>;
}

interface CacheEntry<T> {
  data: T[];
  fetchedAt: number;
}

type Fetcher = (url: string, timeoutMs: number, options?: RequestInit) => Promise<Response>;

const ARKANSAS_COVERAGE: ProviderCoverage = {
  north: 36.75,
  south: 33.0,
  east: -89.55,
  west: -94.8,
  label: "Arkansas",
};

const ARDOT_PROVENANCE: ObservationProvenance = {
  provider: "OFFICIAL/STATE_TRANSPORTATION" as ObservationProvenance["provider"],
  sourceId: "ardot-idrive",
  sourceName: "Arkansas DOT IDrive Arkansas",
  official: true,
  experimental: false,
  displayLabel: "ARDOT IDrive",
};

const IDRIVE_LAYER_BASE_URL = "https://layers.idrivearkansas.com";
const IDRIVE_APP_URL = "https://www.idrivearkansas.com/";
const ROAD_CACHE_TTL_MS = 2 * 60_000;
const CAMERA_CACHE_TTL_MS = 5 * 60_000;
const STALE_CACHE_TTL_MS = 30 * 60_000;
const DEFAULT_PROVIDER_TIMEOUT_MS = 4_500;
const MAX_ROAD_RESULTS = 220;
const MAX_CAMERA_RESULTS = 260;

const roadCache = new Map<string, CacheEntry<RoadConditionEvent>>();
const cameraCache = new Map<string, CacheEntry<TrafficCamera>>();
const inFlight = new Map<string, Promise<unknown>>();

function classifyProviderFetchError(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();
  if (name === "AbortError" || lower.includes("abort")) return "Timed out waiting for a response.";
  if (lower.includes("certificate") || lower.includes("ssl") || lower.includes("tls")) return "TLS or certificate check failed.";
  if (lower.includes("refused") || lower.includes("econnrefused")) return "Host refused the connection.";
  if (lower.includes("dns") || lower.includes("name_not_resolved") || lower.includes("enotfound")) return "Host name could not be resolved.";
  if (lower.includes("network") || lower.includes("failed to fetch") || lower.includes("load failed")) return "Network request failed.";
  if (lower.startsWith("http ")) return message;
  return "Provider request failed.";
}

async function providerFetchWithTimeout(url: string, timeoutMs: number, options: RequestInit = {}) {
  const controller = new AbortController();
  const parentSignal = options.signal;
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } finally {
    globalThis.clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function nowMs() {
  return Date.now();
}

export function isValidCoordinate(lat: unknown, lon: unknown) {
  const latNum = typeof lat === "number" ? lat : Number(lat);
  const lonNum = typeof lon === "number" ? lon : Number(lon);
  return Number.isFinite(latNum) && Number.isFinite(lonNum) && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
}

export function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeProviderText(value: unknown, maxLength = 220) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseProviderTime(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function freshnessForTimestamp(updatedAt: number | null, now = nowMs()) {
  if (!updatedAt) return "unavailable" as const;
  const age = now - updatedAt;
  if (age <= 15 * 60_000) return "fresh" as const;
  if (age <= 60 * 60_000) return "aging" as const;
  return "stale" as const;
}

function viewportIntersectsCoverage(viewport: MapViewport, coverage: ProviderCoverage) {
  return viewport.south <= coverage.north && viewport.north >= coverage.south && viewport.west <= coverage.east && viewport.east >= coverage.west;
}

function pointInViewport(point: { lat: number; lon: number }, viewport: MapViewport, padding = 0.25) {
  return point.lat <= viewport.north + padding
    && point.lat >= viewport.south - padding
    && point.lon <= viewport.east + padding
    && point.lon >= viewport.west - padding;
}

function cacheKey(providerId: string, viewport: MapViewport) {
  const bucket = viewport.zoom >= 9 ? 0.12 : viewport.zoom >= 5.5 ? 0.35 : 0.85;
  return [
    providerId,
    Math.floor(viewport.north / bucket),
    Math.floor(viewport.south / bucket),
    Math.floor(viewport.east / bucket),
    Math.floor(viewport.west / bucket),
    viewport.zoom >= 9 ? "close" : viewport.zoom >= 5.5 ? "medium" : "far",
  ].join(":");
}

function routeLabel(props: Record<string, unknown>) {
  const routeType = sanitizeProviderText(props.route_type ?? props.route_type_abbr ?? props.sign, 40);
  const route = sanitizeProviderText(props.route ?? props.route_num ?? props.short_route_name, 60);
  if (String(route).toUpperCase().startsWith("I-") || String(route).toUpperCase().startsWith("US ")) return route;
  return [routeType, route].filter(Boolean).join(" ").trim() || null;
}

function normalizeDirection(value: unknown): RoadTravelDirection {
  const lower = sanitizeProviderText(value, 40).toLowerCase();
  if (lower.startsWith("north") || lower === "n") return "northbound";
  if (lower.startsWith("south") || lower === "s") return "southbound";
  if (lower.startsWith("east") || lower === "e") return "eastbound";
  if (lower.startsWith("west") || lower === "w") return "westbound";
  if (lower === "both" || lower === "all" || lower === "alternating all") return "both";
  return "unknown";
}

function normalizeRoadKind(kindHint: string, props: Record<string, unknown>): RoadConditionKind {
  const text = `${kindHint} ${sanitizeProviderText(props.reason ?? props.reason_name ?? props.description ?? props.job_status, 180)}`.toLowerCase();
  if (text.includes("flood")) return "flooding";
  if (text.includes("crash") || text.includes("incident") || text.includes("accident")) return "crash";
  if (text.includes("debris")) return "debris-hazard";
  if (text.includes("winter") || text.includes("ice") || text.includes("snow")) return "winter-condition";
  if (text.includes("fire") || text.includes("smoke")) return "fire-smoke-impact";
  if (text.includes("utility") || text.includes("power")) return "utility-power-issue";
  if (text.includes("disabled")) return "disabled-vehicle";
  if (text.includes("construction") || text.includes("work zone") || kindHint.includes("construction") || kindHint.includes("lane")) return "construction";
  if (text.includes("closure") || text.includes("closed")) return "closure";
  return "other";
}

function normalizeClosureState(props: Record<string, unknown>, kindHint: string): RoadClosureState {
  const lanes = sanitizeProviderText(props.lanes_closed ?? props.lanes ?? props.lanes_affected, 80).toLowerCase();
  const status = sanitizeProviderText(props.status ?? props.closure_type ?? props.travel_impact ?? kindHint, 160).toLowerCase();
  if (lanes.includes("all") || status.includes("closed") || kindHint.includes("closure")) return "closed";
  if (kindHint.includes("lane") || lanes) return "lane-restricted";
  return "unknown";
}

function normalizeRoadSeverity(props: Record<string, unknown>, closureState: RoadClosureState, kind: RoadConditionKind): RoadEventSeverity {
  if (closureState === "closed") return "critical";
  if (kind === "flooding" || kind === "crash" || kind === "fire-smoke-impact") return "high";
  if (closureState === "lane-restricted" || kind === "construction") return "medium";
  const impact = sanitizeProviderText(props.travel_impact ?? props.description, 160).toLowerCase();
  if (impact.includes("no through traffic") || impact.includes("all lanes")) return "critical";
  if (impact.includes("delay")) return "medium";
  return "unknown";
}

function normalizeRoadFeature(feature: unknown, providerId: string, kindHint: string): RoadConditionEvent | null {
  if (!feature || typeof feature !== "object") return null;
  const candidate = feature as { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown[] } };
  const props = candidate.properties ?? {};
  const coordinates = candidate.geometry?.coordinates;
  const lon = Array.isArray(coordinates) ? Number(coordinates[0]) : Number(props.longitude ?? props.lon ?? props.mp_long);
  const lat = Array.isArray(coordinates) ? Number(coordinates[1]) : Number(props.latitude ?? props.lat ?? props.mp_lat);
  if (!isValidCoordinate(lat, lon)) return null;
  const recordId = sanitizeProviderText(props.gid ?? props.id ?? props.job_number ?? `${lat},${lon}`, 80);
  const kind = normalizeRoadKind(kindHint, props);
  const closureState = normalizeClosureState(props, kindHint);
  const severity = normalizeRoadSeverity(props, closureState, kind);
  const updatedAt = parseProviderTime(props.updated_date ?? props.updated_at_time ?? props.closed_date ?? props.date_closed ?? props.start_date) ?? nowMs();
  const startsAt = parseProviderTime(props.closure_starts ?? props.start_date ?? props.date_closed);
  const endsAt = parseProviderTime(props.closure_ends ?? props.expected_end ?? props.estimated_);
  const roadway = routeLabel(props);
  const reason = sanitizeProviderText(props.reason_name ?? props.reason ?? props.job_status ?? kind, 80);
  const description = sanitizeProviderText(props.description ?? props.project_de ?? props.trvl_impct ?? props.travel_impact ?? reason, 320);
  const freshness = freshnessForTimestamp(updatedAt);
  const title = [reason, roadway].filter(Boolean).join(" - ") || "Road condition";
  return {
    id: `${providerId}:road:${recordId}`,
    providerId,
    providerRecordId: recordId,
    kind,
    geometry: { type: "point", lat, lon },
    closureState,
    severity,
    title,
    startsAt,
    endsAt,
    direction: normalizeDirection(props.travel_direction_name ?? props.default_direction ?? props.direction),
    roadway,
    status: sanitizeProviderText(props.status ?? props.closure_type ?? closureState, 80) || closureState,
    description,
    lat,
    lon,
    provider: ARDOT_PROVENANCE,
    updatedAt,
    freshness,
    stale: freshness === "stale" || freshness === "unavailable",
    sourceUrl: IDRIVE_APP_URL,
    rawSourceReference: recordId,
  };
}

function normalizeCameraFeature(feature: unknown, providerId: string): TrafficCamera | null {
  if (!feature || typeof feature !== "object") return null;
  const candidate = feature as { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown[] } };
  const props = candidate.properties ?? (feature as Record<string, unknown>);
  const coordinates = candidate.geometry?.coordinates;
  const lon = Array.isArray(coordinates) ? Number(coordinates[0]) : Number(props.longitude);
  const lat = Array.isArray(coordinates) ? Number(coordinates[1]) : Number(props.latitude);
  if (!isValidCoordinate(lat, lon)) return null;
  const recordId = sanitizeProviderText(props.id ?? props.ahtd_camera_number ?? `${lat},${lon}`, 80);
  const updatedAt = parseProviderTime(props.last_update ?? props.updated_at ?? props.updatedAt);
  const status = sanitizeProviderText(props.status, 40).toLowerCase();
  const availability: TrafficCameraAvailability = status === "online" ? "available" : status === "offline" || status === "disabled" ? "offline" : "unknown";
  const freshness = availability === "offline" ? "unavailable" : freshnessForTimestamp(updatedAt ?? nowMs());
  const imageUrl = safeHttpUrl(`https://actis.idrivearkansas.com/index.php/api/cameras/image?camera=${encodeURIComponent(recordId)}`);
  return {
    id: `${providerId}:camera:${recordId}`,
    providerId,
    providerRecordId: recordId,
    name: sanitizeProviderText(props.name ?? props.description ?? `Camera ${recordId}`, 120) || `Camera ${recordId}`,
    lat,
    lon,
    roadway: routeLabel(props),
    direction: sanitizeProviderText(props.direction_name ?? props.default_direction, 40) || null,
    source: "ARDOT IDrive",
    provider: { ...ARDOT_PROVENANCE, provider: "PUBLIC/TRAFFIC" },
    lastUpdateAt: updatedAt,
    imageUrl,
    streamUrl: safeHttpUrl(props.hls_stream_protected ?? props.hls_stream),
    thumbnailUrl: safeHttpUrl(props.thumbnail_url),
    previewUrl: imageUrl,
    availability,
    freshness,
    sourceUrl: IDRIVE_APP_URL,
    attribution: "Arkansas DOT IDrive Arkansas",
  };
}

async function fetchJson(url: string, timeoutMs: number, signal: AbortSignal | undefined, fetcher: Fetcher = providerFetchWithTimeout) {
  const response = await fetcher(url, timeoutMs, { signal, headers: { Accept: "application/json, text/javascript;q=0.8, */*;q=0.2" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.trim().startsWith("var static_api")) {
    const json = text.replace(/^var static_api\s*=\s*/, "").replace(/;\s*$/, "");
    return JSON.parse(json);
  }
  return JSON.parse(text);
}

export async function fetchArdotRoadConditions(context: LayerQueryContext, signal?: AbortSignal, fetcher: Fetcher = providerFetchWithTimeout) {
  const urls: Array<[string, string]> = [
    [`${IDRIVE_LAYER_BASE_URL}/closures_points.geojson`, "closure"],
    [`${IDRIVE_LAYER_BASE_URL}/laneclosures_points.geojson`, "lane"],
    [`${IDRIVE_LAYER_BASE_URL}/construction_point.geojson`, "construction"],
  ];
  const results: RoadConditionEvent[] = [];
  for (const [url, kindHint] of urls) {
    const json = await fetchJson(url, DEFAULT_PROVIDER_TIMEOUT_MS, signal, fetcher);
    const features = Array.isArray(json?.features) ? json.features : [];
    for (const feature of features) {
      const event = normalizeRoadFeature(feature, "ardot-idrive", kindHint);
      if (event && pointInViewport(event, context.viewport)) results.push(event);
      if (results.length >= MAX_ROAD_RESULTS) break;
    }
  }
  return dedupeById(results).slice(0, MAX_ROAD_RESULTS);
}

export async function fetchArdotTrafficCameras(context: LayerQueryContext, signal?: AbortSignal, fetcher: Fetcher = providerFetchWithTimeout) {
  const json = await fetchJson(`${IDRIVE_LAYER_BASE_URL}/cameras.geojson`, DEFAULT_PROVIDER_TIMEOUT_MS, signal, fetcher);
  const features = Array.isArray(json?.features) ? json.features : [];
  const cameras: TrafficCamera[] = features
    .map((feature: unknown) => normalizeCameraFeature(feature, "ardot-idrive"))
    .filter((camera: TrafficCamera | null): camera is TrafficCamera => camera != null)
    .filter((camera: TrafficCamera) => pointInViewport(camera, context.viewport))
    .slice(0, MAX_CAMERA_RESULTS);
  return dedupeById(cameras);
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

export const ROAD_CONDITION_PROVIDERS: RoadConditionProvider[] = [
  {
    id: "ardot-idrive",
    name: "Arkansas DOT IDrive",
    coverage: ARKANSAS_COVERAGE,
    enabled: true,
    priority: 10,
    minRefreshMs: ROAD_CACHE_TTL_MS,
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    attribution: "Arkansas DOT IDrive Arkansas",
    fetchViewport: fetchArdotRoadConditions,
  },
];

export const TRAFFIC_CAMERA_PROVIDERS: TrafficCameraProvider[] = [
  {
    id: "ardot-idrive",
    name: "Arkansas DOT IDrive",
    coverage: ARKANSAS_COVERAGE,
    enabled: true,
    priority: 10,
    minRefreshMs: CAMERA_CACHE_TTL_MS,
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    attribution: "Arkansas DOT IDrive Arkansas",
    fetchViewport: fetchArdotTrafficCameras,
  },
];

export function roadProvidersForViewport(viewport: MapViewport, providers = ROAD_CONDITION_PROVIDERS) {
  return providers.filter((provider) => provider.enabled && viewportIntersectsCoverage(viewport, provider.coverage)).sort((a, b) => a.priority - b.priority);
}

export function trafficCameraProvidersForViewport(viewport: MapViewport, providers = TRAFFIC_CAMERA_PROVIDERS) {
  return providers.filter((provider) => provider.enabled && viewportIntersectsCoverage(viewport, provider.coverage)).sort((a, b) => a.priority - b.priority);
}

async function fetchProviderWithCache<T extends { id: string; stale?: boolean; freshness?: string }>(
  keyPrefix: string,
  cache: Map<string, CacheEntry<T>>,
  provider: { id: string; name: string; minRefreshMs: number; fetchViewport(context: LayerQueryContext, signal?: AbortSignal): Promise<T[]> },
  context: LayerQueryContext,
  signal?: AbortSignal,
) {
  const key = `${keyPrefix}:${cacheKey(provider.id, context.viewport)}`;
  const cached = cache.get(key);
  const now = nowMs();
  if (cached && now - cached.fetchedAt <= provider.minRefreshMs) return { data: cached.data, stale: false };
  const requestKey = `${key}:request`;
  let request = inFlight.get(requestKey) as Promise<T[]> | undefined;
  if (!request) {
    request = provider.fetchViewport(context, signal).finally(() => inFlight.delete(requestKey));
    inFlight.set(requestKey, request);
  }
  try {
    const data = await request;
    cache.set(key, { data, fetchedAt: nowMs() });
    return { data, stale: false };
  } catch (error) {
    if (cached && now - cached.fetchedAt <= STALE_CACHE_TTL_MS) {
      return { data: cached.data.map((item) => ({ ...item, stale: true, freshness: "stale" })), stale: true };
    }
    throw error;
  }
}

export async function getRoadConditionsForViewport(context: LayerQueryContext, signal?: AbortSignal): Promise<ViewportLayerResult<RoadConditionEvent>> {
  const providers = roadProvidersForViewport(context.viewport);
  const fetchedAt = nowMs();
  if (providers.length === 0) {
    return { data: [], status: "outside-coverage", message: "Outside current road-condition provider coverage. v0.1 supports Arkansas DOT IDrive coverage.", simulated: false, fetchedAt };
  }
  const settled = await Promise.allSettled(providers.map((provider) => fetchProviderWithCache("road", roadCache, provider, context, signal)));
  const data = settled.flatMap((result) => result.status === "fulfilled" ? result.value.data : []);
  const anyStale = settled.some((result) => result.status === "fulfilled" && result.value.stale);
  if (data.length > 0) {
    return { data: dedupeById(data), status: anyStale ? "stale" : "ready", message: anyStale ? "Road provider unavailable; showing cached stale data." : "Road conditions loaded.", simulated: false, fetchedAt, stale: anyStale, providerIds: providers.map((provider) => provider.id) };
  }
  const failures = settled.filter((result) => result.status === "rejected");
  if (failures.length === providers.length) {
    const first = failures[0] as PromiseRejectedResult | undefined;
    return { data: [], status: "unavailable", message: classifyProviderFetchError(first?.reason) || "Road-condition provider unavailable.", simulated: false, fetchedAt, providerIds: providers.map((provider) => provider.id) };
  }
  return { data: [], status: "empty", message: "No road conditions reported in this viewport.", simulated: false, fetchedAt, providerIds: providers.map((provider) => provider.id) };
}

export async function getTrafficCamerasForViewport(context: LayerQueryContext, signal?: AbortSignal): Promise<ViewportLayerResult<TrafficCamera>> {
  const providers = trafficCameraProvidersForViewport(context.viewport);
  const fetchedAt = nowMs();
  if (providers.length === 0) {
    return { data: [], status: "outside-coverage", message: "Outside current public-camera provider coverage. v0.1 supports Arkansas DOT IDrive coverage.", simulated: false, fetchedAt };
  }
  const settled = await Promise.allSettled(providers.map((provider) => fetchProviderWithCache("camera", cameraCache, provider, context, signal)));
  const data = settled.flatMap((result) => result.status === "fulfilled" ? result.value.data : []);
  const anyStale = settled.some((result) => result.status === "fulfilled" && result.value.stale);
  if (data.length > 0) {
    return { data: dedupeById(data), status: anyStale ? "stale" : "ready", message: anyStale ? "Camera provider unavailable; showing cached stale data." : "Public traffic cameras loaded.", simulated: false, fetchedAt, stale: anyStale, providerIds: providers.map((provider) => provider.id) };
  }
  const failures = settled.filter((result) => result.status === "rejected");
  if (failures.length === providers.length) {
    const first = failures[0] as PromiseRejectedResult | undefined;
    return { data: [], status: "unavailable", message: classifyProviderFetchError(first?.reason) || "Public traffic-camera provider unavailable.", simulated: false, fetchedAt, providerIds: providers.map((provider) => provider.id) };
  }
  return { data: [], status: "empty", message: "No public traffic cameras reported in this viewport.", simulated: false, fetchedAt, providerIds: providers.map((provider) => provider.id) };
}

export const __roadCameraProviderTest = {
  normalizeRoadFeature,
  normalizeCameraFeature,
  roadProvidersForViewport,
  trafficCameraProvidersForViewport,
  freshnessForTimestamp,
  safeHttpUrl,
  sanitizeProviderText,
  isValidCoordinate,
};
