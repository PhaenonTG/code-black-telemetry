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

const KANSAS_COVERAGE: ProviderCoverage = {
  north: 40.01,
  south: 36.99,
  east: -94.58,
  west: -102.06,
  label: "Kansas",
};

const MISSOURI_COVERAGE: ProviderCoverage = {
  north: 40.62,
  south: 35.99,
  east: -89.09,
  west: -95.78,
  label: "Missouri",
};

const OKLAHOMA_COVERAGE: ProviderCoverage = {
  north: 37.01,
  south: 33.61,
  east: -94.42,
  west: -103.01,
  label: "Oklahoma",
};

const KANDRIVE_PROVENANCE: ObservationProvenance = {
  provider: "OFFICIAL/STATE_TRANSPORTATION" as ObservationProvenance["provider"],
  sourceId: "kandrive-kdot",
  sourceName: "Kansas DOT KanDrive",
  official: true,
  experimental: false,
  displayLabel: "KDOT KanDrive",
};

const MODOT_PROVENANCE: ObservationProvenance = {
  provider: "OFFICIAL/STATE_TRANSPORTATION" as ObservationProvenance["provider"],
  sourceId: "modot-traveler",
  sourceName: "Missouri DOT Traveler Information",
  official: true,
  experimental: false,
  displayLabel: "MoDOT Traveler Info",
};

const ODOT_PROVENANCE: ObservationProvenance = {
  provider: "OFFICIAL/STATE_TRANSPORTATION" as ObservationProvenance["provider"],
  sourceId: "odot-wzdx",
  sourceName: "Oklahoma DOT Work Zone Data Exchange",
  official: true,
  experimental: false,
  displayLabel: "ODOT WZDx",
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
  // Some providers (MoDOT's ArcGIS date fields, KDOT/KanDrive's lastUpdated.timestamp) hand back
  // an already-epoch-ms number rather than a date string. Date.parse(String(epochMs)) is NOT a
  // valid date string and silently returns NaN, which would otherwise fall back to "now" and
  // fabricate freshness for reports that may be hours or days old.
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
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
  // Only a kindHint-exact match, never a text keyword -- a source-tagged "weather-hazard" feed
  // (e.g. KanDrive's Weather-Related Impacts layer) is the only thing that lands here, so this
  // can never change ARDOT's existing classification.
  if (kindHint === "weather-hazard") return "weather-hazard";
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
    // IDrive exposes `hls_stream_protected`, but direct browser/WebView requests return 403 without
    // provider-controlled access. v0.1 therefore treats the public image endpoint as a refreshed
    // snapshot and links back to IDrive instead of presenting the protected HLS URL as playable.
    streamUrl: safeHttpUrl(props.hls_stream),
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

// --- Kansas DOT / KanDrive -------------------------------------------------------------------
//
// KanDrive (kandrive.gov) is KDOT's own official public traveler-information site. Its frontend
// calls a first-party GraphQL API at kandrive.gov/api/graphql to render the exact same map this
// integration reads -- confirmed served with `Access-Control-Allow-Origin: *`, i.e. deliberately
// open for public/cross-origin consumption (unlike MoDOT and ODOT below). No key, no login, no
// scraping of rendered HTML: this is the same JSON contract KDOT's own site depends on.
//
// The query text below is copied byte-for-byte (including whitespace) from KanDrive's own shipped
// bundle. That turned out to matter: an equivalent but differently-formatted query for a *different*
// KanDrive operation (listCameraViewsQuery) was silently rejected by their edge/CDN and fell back to
// serving the SPA's index.html instead of an error -- while this exact byte-for-byte text has been
// confirmed working via direct request outside the browser. So camera data is deliberately sourced
// from this same MapFeatures query (which already includes Camera-typed features) rather than a
// second, less certain endpoint.
const KANDRIVE_GRAPHQL_URL = "https://www.kandrive.gov/api/graphql";
const KANDRIVE_APP_URL = "https://www.kandrive.gov/";
const KANDRIVE_MAP_FEATURES_QUERY = "query MapFeatures($input: MapFeaturesArgs!, $plowType: String) {\n\t\tmapFeaturesQuery(input: $input) {\n\t\t\tmapFeatures {\n\t\t\t\tbbox\n\t\t\t\ttitle\n\t\t\t\ttooltip\n\t\t\t\turi\n\t\t\t\tfeatures {\n\t\t\t\t\tid\n\t\t\t\t\tgeometry\n\t\t\t\t\tproperties\n\t\t\t\t\ttype\n\t\t\t\t}\n\t\t\t\t... on Cluster {\n\t\t\t\t\tmaxZoom\n\t\t\t\t}\n\t\t\t\t... on Sign {\n\t\t\t\t\tsignDisplayType\n\t\t\t\t}\n\t\t\t\t... on Event {\n\t\t\t\t\tpriority\n\t\t\t\t}\n\t\t\t\t__typename\n\t\t\t\t... on Camera {\n\t\t\t\t\tactive\n\t\t\t\t\tviews(limit: 5) {\n\t\t\t\t\t\turi\n\t\t\t\t\t\t... on CameraView {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t}\n\t\t\t\t\t\tcategory\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\t... on Plow {\n\t\t\t\t\tviews(limit: 5, plowType: $plowType) {\n\t\t\t\t\t\turi\n\t\t\t\t\t\t... on PlowCameraView {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t}\n\t\t\t\t\t\tcategory\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\terror {\n\t\t\t\tmessage\n\t\t\t\ttype\n\t\t\t}\n\t\t}\n\t}";
// Same query as above, with one addition: `sources { type src }` inside the Camera view fragment.
// Confirmed via direct request that this modified selection set is still accepted (unlike a
// differently-formatted listCameraViewsQuery attempt, which was rejected outright) -- but `sources`
// carries a short-lived signed HLS token, so this variant is deliberately used ONLY for an on-demand,
// single-camera lookup at the moment a camera viewer actually opens, never for the viewport list/cache
// path above, so a fetched token is never left to expire unused in the cache.
const KANDRIVE_MAP_FEATURES_WITH_SOURCES_QUERY = "query MapFeatures($input: MapFeaturesArgs!, $plowType: String) {\n\t\tmapFeaturesQuery(input: $input) {\n\t\t\tmapFeatures {\n\t\t\t\tbbox\n\t\t\t\ttitle\n\t\t\t\ttooltip\n\t\t\t\turi\n\t\t\t\tfeatures {\n\t\t\t\t\tid\n\t\t\t\t\tgeometry\n\t\t\t\t\tproperties\n\t\t\t\t\ttype\n\t\t\t\t}\n\t\t\t\t... on Cluster {\n\t\t\t\t\tmaxZoom\n\t\t\t\t}\n\t\t\t\t... on Sign {\n\t\t\t\t\tsignDisplayType\n\t\t\t\t}\n\t\t\t\t... on Event {\n\t\t\t\t\tpriority\n\t\t\t\t}\n\t\t\t\t__typename\n\t\t\t\t... on Camera {\n\t\t\t\t\tactive\n\t\t\t\t\tviews(limit: 5) {\n\t\t\t\t\t\turi\n\t\t\t\t\t\t... on CameraView {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t\tsources {\n\t\t\t\t\t\t\t\ttype\n\t\t\t\t\t\t\t\tsrc\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}\n\t\t\t\t\t\tcategory\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\t... on Plow {\n\t\t\t\t\tviews(limit: 5, plowType: $plowType) {\n\t\t\t\t\t\turi\n\t\t\t\t\t\t... on PlowCameraView {\n\t\t\t\t\t\t\turl\n\t\t\t\t\t\t}\n\t\t\t\t\t\tcategory\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t\terror {\n\t\t\t\tmessage\n\t\t\t\ttype\n\t\t\t}\n\t\t}\n\t}";
// Layers KDOT tags as official road-condition reports. Excludes "truckersReports" (crowd-submitted,
// not agency-verified) and "otherStateInfo" (a pass-through of neighboring states' own feeds, which
// this integration sources directly from each state instead).
const KANDRIVE_ROAD_LAYER_SLUGS = ["roadClosures", "roadReports", "constructionReports", "weatherRelatedImpacts", "winterDriving"];

interface KandriveGeometry {
  type?: string;
  coordinates?: unknown;
}
interface KandriveFeature {
  geometry?: KandriveGeometry;
  type?: string;
}
interface KandriveCameraView {
  url?: string | null;
  category?: string | null;
  sources?: Array<{ type?: string | null; src?: string | null }> | null;
}
interface KandriveMapItem {
  title?: string;
  tooltip?: string;
  uri?: string;
  __typename?: string;
  features?: KandriveFeature[];
  active?: boolean;
  views?: KandriveCameraView[];
}

async function fetchKandriveMapFeatures(context: LayerQueryContext, layerSlugs: string[], signal: AbortSignal | undefined, fetcher: Fetcher) {
  const { viewport } = context;
  const body = JSON.stringify({
    query: KANDRIVE_MAP_FEATURES_QUERY,
    variables: { input: { north: viewport.north, south: viewport.south, east: viewport.east, west: viewport.west, zoom: Math.floor(viewport.zoom), layerSlugs }, plowType: null },
  });
  const response = await fetcher(KANDRIVE_GRAPHQL_URL, DEFAULT_PROVIDER_TIMEOUT_MS, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  const items: KandriveMapItem[] = json?.data?.mapFeaturesQuery?.mapFeatures ?? [];
  return items;
}

function kandriveFirstPoint(item: KandriveMapItem): { lat: number; lon: number } | null {
  for (const feature of item.features ?? []) {
    if (feature.geometry?.type === "Point" && Array.isArray(feature.geometry.coordinates)) {
      const [lon, lat] = feature.geometry.coordinates as [number, number];
      if (isValidCoordinate(lat, lon)) return { lat, lon };
    }
  }
  return null;
}

function kandriveParseTitle(title: string) {
  const match = /^(.*?)\s+(northbound|southbound|eastbound|westbound|in both directions):/i.exec(title);
  if (!match) return { roadway: null, direction: "unknown" as RoadTravelDirection };
  const directionWord = match[2].toLowerCase() === "in both directions" ? "both" : match[2];
  return { roadway: sanitizeProviderText(match[1], 60) || null, direction: normalizeDirection(directionWord) };
}

function normalizeKandriveEvent(item: KandriveMapItem, providerId: string, kindHintBySlug: string): RoadConditionEvent | null {
  if (item.__typename !== "Event" || !item.title) return null;
  const point = kandriveFirstPoint(item);
  if (!point) return null;
  const recordId = sanitizeProviderText((item.uri ?? "").replace(/^event\//, "") || `${point.lat},${point.lon}`, 80);
  const { roadway, direction } = kandriveParseTitle(item.title);
  const description = sanitizeProviderText(item.tooltip ?? item.title, 320);
  const syntheticProps = { reason: item.title, description, status: item.title, travel_impact: description };
  const kind = normalizeRoadKind(kindHintBySlug, syntheticProps);
  const closureState = normalizeClosureState(syntheticProps, kindHintBySlug);
  const severity = normalizeRoadSeverity(syntheticProps, closureState, kind);
  // KanDrive's MapFeatures query does not expose a per-event lastUpdated field (only Camera and
  // dashboard-only queries do). Rather than fabricate a timestamp, this is treated the same as the
  // codebase's existing convention for other genuinely-unknown timestamps: the moment of this live
  // fetch, since the event is being observed as currently active right now.
  const updatedAt = nowMs();
  return {
    id: `${providerId}:road:${recordId}`,
    providerId,
    providerRecordId: recordId,
    kind,
    geometry: { type: "point", lat: point.lat, lon: point.lon },
    closureState,
    severity,
    title: sanitizeProviderText(item.title, 160),
    startsAt: null,
    endsAt: null,
    direction,
    roadway,
    status: sanitizeProviderText(item.title, 80),
    description,
    lat: point.lat,
    lon: point.lon,
    provider: KANDRIVE_PROVENANCE,
    updatedAt,
    freshness: freshnessForTimestamp(updatedAt),
    stale: false,
    sourceUrl: KANDRIVE_APP_URL,
    rawSourceReference: recordId,
  };
}

function normalizeKandriveCamera(item: KandriveMapItem, providerId: string): TrafficCamera | null {
  if (item.__typename !== "Camera" || !item.title) return null;
  const point = kandriveFirstPoint(item);
  if (!point) return null;
  const recordId = sanitizeProviderText((item.uri ?? "").replace(/^camera\//, "") || `${point.lat},${point.lon}`, 80);
  const primaryView = (item.views ?? [])[0];
  const previewUrl = safeHttpUrl(primaryView?.url);
  const availability: TrafficCameraAvailability = item.active === false ? "offline" : item.active === true ? "available" : "unknown";
  const updatedAt = availability === "offline" ? null : nowMs();
  return {
    id: `${providerId}:camera:${recordId}`,
    providerId,
    providerRecordId: recordId,
    name: sanitizeProviderText(item.title, 120),
    lat: point.lat,
    lon: point.lon,
    roadway: kandriveParseTitle(item.title).roadway,
    direction: null,
    source: "KDOT KanDrive",
    provider: { ...KANDRIVE_PROVENANCE, provider: "PUBLIC/TRAFFIC" },
    lastUpdateAt: updatedAt,
    imageUrl: previewUrl,
    // KanDrive's dashboard-only camera query exposes short-lived signed HLS tokens (~5 min expiry)
    // for VIDEO-category cameras; caching that URL here would very likely hand back an already-
    // expired stream by the time it's opened. Snapshot image + link back to KanDrive instead,
    // matching the "protected/unembeddable streams stay source-link/snapshot fallback" pattern.
    streamUrl: null,
    thumbnailUrl: previewUrl,
    previewUrl,
    availability,
    freshness: availability === "offline" ? "unavailable" : freshnessForTimestamp(updatedAt),
    sourceUrl: `${KANDRIVE_APP_URL}${item.uri ?? ""}`,
    attribution: "Kansas DOT KanDrive",
  };
}

export async function fetchKandriveRoadConditions(context: LayerQueryContext, signal?: AbortSignal, fetcher: Fetcher = providerFetchWithTimeout): Promise<RoadConditionEvent[]> {
  const items = await fetchKandriveMapFeatures(context, KANDRIVE_ROAD_LAYER_SLUGS, signal, fetcher);
  const kindHintForSlug = (item: KandriveMapItem) => {
    const uri = item.uri ?? "";
    if (uri.startsWith("event/")) {
      const tooltip = `${item.title ?? ""} ${item.tooltip ?? ""}`.toLowerCase();
      if (tooltip.includes("closed") || tooltip.includes("closure")) return "closure";
    }
    return "";
  };
  const results = items
    .map((item) => normalizeKandriveEvent(item, "kandrive-kdot", kindHintForSlug(item)))
    .filter((event): event is RoadConditionEvent => event != null)
    .filter((event) => pointInViewport(event, context.viewport))
    .slice(0, MAX_ROAD_RESULTS);
  return dedupeById(results);
}

export async function fetchKandriveTrafficCameras(context: LayerQueryContext, signal?: AbortSignal, fetcher: Fetcher = providerFetchWithTimeout): Promise<TrafficCamera[]> {
  const items = await fetchKandriveMapFeatures(context, [], signal, fetcher);
  const results = items
    .map((item) => normalizeKandriveCamera(item, "kandrive-kdot"))
    .filter((camera): camera is TrafficCamera => camera != null)
    .filter((camera) => pointInViewport(camera, context.viewport))
    .slice(0, MAX_CAMERA_RESULTS);
  return dedupeById(results);
}

// On-demand, single-camera live source lookup for a KanDrive camera whose viewport-list entry has
// no streamUrl. Called only when a camera viewer actually opens (a rare, human-paced action), never
// on a polling/cache cadence -- so it can't turn into the kind of repeated automated traffic that
// would risk the provider's own rate limiting, and the short-lived token it returns is used
// immediately rather than cached. The lookup box is a tight envelope around the camera's own known
// coordinates at a high zoom, which keeps it rendered as an individual Camera feature rather than
// folded into a Cluster.
export async function fetchKandriveLiveCameraSource(camera: { lat: number; lon: number; providerRecordId: string }, signal?: AbortSignal, fetcher: Fetcher = providerFetchWithTimeout): Promise<string | null> {
  const pad = 0.01;
  const body = JSON.stringify({
    query: KANDRIVE_MAP_FEATURES_WITH_SOURCES_QUERY,
    variables: {
      input: { north: camera.lat + pad, south: camera.lat - pad, east: camera.lon + pad, west: camera.lon - pad, zoom: 16, layerSlugs: [] },
      plowType: null,
    },
  });
  const response = await fetcher(KANDRIVE_GRAPHQL_URL, DEFAULT_PROVIDER_TIMEOUT_MS, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body });
  if (!response.ok) return null;
  const json = await response.json();
  const items: KandriveMapItem[] = json?.data?.mapFeaturesQuery?.mapFeatures ?? [];
  const targetUri = `camera/${camera.providerRecordId}`;
  const match = items.find((item) => item.__typename === "Camera" && item.uri === targetUri);
  for (const view of match?.views ?? []) {
    const src = view.sources?.find((source) => safeHttpUrl(source?.src))?.src;
    const safeSrc = safeHttpUrl(src);
    if (safeSrc) return safeSrc;
  }
  return null;
}

// --- Missouri DOT Traveler Information --------------------------------------------------------
//
// MoDOT publishes its live road-event and camera data through its own ArcGIS Server REST services
// at mapping.modot.org -- the same backend traveler.modot.org's official map reads. Confirmed via
// direct request: the service supports `f=geojson` output and is open to unauthenticated read-only
// queries (no key, no login). Its CORS policy, however, only reflects `Access-Control-Allow-Origin`
// for MoDOT's own domains (verified: an Origin of traveler.modot.org gets the header back, an
// arbitrary origin does not) -- so a direct browser fetch from this app's own origins fails CORS.
//
// Routed through this app's own same-origin proxy (functions/api/modot/[[path]].ts, a
// Cloudflare Pages Function that relays server-to-server, where CORS doesn't apply) instead of
// mapping.modot.org directly. That function only exists on the web/ops (ops.codeblackwx.com)
// deployment; the native app and web/public have no such route, so this same relative path 404s
// there -- which the existing per-provider unavailable/stale path already handles honestly, exactly
// as it did before this proxy existed. Nothing regresses where the proxy is absent; it only adds
// function where it's present.
const MODOT_BASE_URL = "/api/modot";
const MODOT_TRAVELER_MAP_URL = "https://traveler.modot.org/map/index.html";
const MODOT_CAMERAS_URL = `${MODOT_BASE_URL}/NWSDATA/MapServer/0`;

const MODOT_ROAD_LAYERS: Array<{ layer: number; kindHint: string }> = [
  { layer: 0, kindHint: "flooding" },
  { layer: 21, kindHint: "crash" },
  { layer: 24, kindHint: "crash" },
  { layer: 25, kindHint: "crash" },
  { layer: 22, kindHint: "construction" },
  { layer: 26, kindHint: "construction" },
  { layer: 27, kindHint: "construction" },
  { layer: 23, kindHint: "winter-condition" },
];

function arcgisEnvelopeQueryUrl(baseUrl: string, viewport: MapViewport, extraParams: Record<string, string> = {}) {
  const params = new URLSearchParams({
    f: "geojson",
    outFields: "*",
    geometry: `${viewport.west},${viewport.south},${viewport.east},${viewport.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "150",
    ...extraParams,
  });
  return `${baseUrl}/query?${params.toString()}`;
}

function normalizeModotRoadFeature(feature: unknown, providerId: string, kindHint: string): RoadConditionEvent | null {
  if (!feature || typeof feature !== "object") return null;
  const candidate = feature as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown[] } };
  const props = candidate.properties ?? {};
  const coordinates = candidate.geometry?.coordinates;
  const lon = Array.isArray(coordinates) ? Number(coordinates[0]) : NaN;
  const lat = Array.isArray(coordinates) ? Number(coordinates[1]) : NaN;
  if (!isValidCoordinate(lat, lon)) return null;
  const recordId = sanitizeProviderText(props.OBJECT_ID ?? props.OBJECTID ?? props.ESRI_OID ?? props.DATA_ID ?? `${lat},${lon}`, 80);
  const impact = sanitizeProviderText(props.LEVEL_OF_IMPACT_CODE ?? props.LEVEL_OF_IMPACT, 80);
  const syntheticProps = {
    reason: props.TYPE_CODE ?? props.WORK_TYPE ?? kindHint,
    description: props.EXT_COMMENT ?? props.EXTERNAL_COMMENT ?? [props.BEGIN_DESCRIPTION, props.END_DESCRIPTION].filter(Boolean).join(" to "),
    status: impact,
    travel_impact: impact,
    lanes_closed: props.NUMBER_LANES_CLOSED,
    closure_type: impact,
  };
  const kind = normalizeRoadKind(kindHint, syntheticProps);
  const closureState = normalizeClosureState(syntheticProps, kindHint);
  const severity = normalizeRoadSeverity(syntheticProps, closureState, kind);
  const updatedAt = parseProviderTime(props.LAST_CHANGED_DATE ?? props.STATUS_DATE ?? props.START_DATE) ?? nowMs();
  const roadway = [props.DESIGNATION, props.TRAVELWAY_NAME].filter(Boolean).map((v) => sanitizeProviderText(v, 40)).join(" ").trim() || null;
  const reason = sanitizeProviderText(syntheticProps.reason, 80);
  const description = sanitizeProviderText(syntheticProps.description, 320);
  const freshness = freshnessForTimestamp(updatedAt);
  return {
    id: `${providerId}:road:${recordId}`,
    providerId,
    providerRecordId: recordId,
    kind,
    geometry: { type: "point", lat, lon },
    closureState,
    severity,
    title: [reason, roadway].filter(Boolean).join(" - ") || "Road condition",
    startsAt: parseProviderTime(props.START_DATE),
    endsAt: parseProviderTime(props.END_DATE),
    direction: normalizeDirection(props.DIRECTION),
    roadway,
    status: sanitizeProviderText(impact || props.STATUS_CODE, 80) || closureState,
    description,
    lat,
    lon,
    provider: MODOT_PROVENANCE,
    updatedAt,
    freshness,
    stale: freshness === "stale" || freshness === "unavailable",
    sourceUrl: MODOT_TRAVELER_MAP_URL,
    rawSourceReference: recordId,
  };
}

function normalizeModotCamera(feature: unknown, providerId: string): TrafficCamera | null {
  if (!feature || typeof feature !== "object") return null;
  const candidate = feature as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown[] } };
  const props = candidate.properties ?? {};
  const coordinates = candidate.geometry?.coordinates;
  const lon = Array.isArray(coordinates) ? Number(coordinates[0]) : Number(props.X);
  const lat = Array.isArray(coordinates) ? Number(coordinates[1]) : Number(props.Y);
  if (!isValidCoordinate(lat, lon)) return null;
  const recordId = sanitizeProviderText(props.CAM_ID ?? `${lat},${lon}`, 80);
  const streamError = sanitizeProviderText(props.STREAM_ERROR, 4).toUpperCase() === "Y";
  const availability: TrafficCameraAvailability = streamError ? "offline" : "available";
  const imageUrl = safeHttpUrl(props.URL1);
  const streamUrl = safeHttpUrl(props.URL2);
  const updatedAt = availability === "offline" ? null : nowMs();
  return {
    id: `${providerId}:camera:${recordId}`,
    providerId,
    providerRecordId: recordId,
    name: sanitizeProviderText(props.DESCRIPTION ?? `Camera ${recordId}`, 120) || `Camera ${recordId}`,
    lat,
    lon,
    roadway: null,
    direction: null,
    source: "MoDOT Traveler Information",
    provider: { ...MODOT_PROVENANCE, provider: "PUBLIC/TRAFFIC" },
    lastUpdateAt: updatedAt,
    imageUrl,
    streamUrl,
    thumbnailUrl: imageUrl,
    previewUrl: imageUrl ?? streamUrl,
    availability,
    freshness: availability === "offline" ? "unavailable" : freshnessForTimestamp(updatedAt),
    sourceUrl: MODOT_TRAVELER_MAP_URL,
    attribution: "Missouri DOT Traveler Information",
  };
}

export async function fetchModotRoadConditions(context: LayerQueryContext, signal?: AbortSignal, fetcher: Fetcher = providerFetchWithTimeout): Promise<RoadConditionEvent[]> {
  const results: RoadConditionEvent[] = [];
  for (const { layer, kindHint } of MODOT_ROAD_LAYERS) {
    const url = arcgisEnvelopeQueryUrl(`${MODOT_BASE_URL}/TravelerInformationData/MapServer/${layer}`, context.viewport);
    const json = await fetchJson(url, DEFAULT_PROVIDER_TIMEOUT_MS, signal, fetcher);
    const features = Array.isArray(json?.features) ? json.features : [];
    for (const feature of features) {
      const event = normalizeModotRoadFeature(feature, "modot-traveler", kindHint);
      if (event) results.push(event);
      if (results.length >= MAX_ROAD_RESULTS) break;
    }
  }
  return dedupeById(results).slice(0, MAX_ROAD_RESULTS);
}

export async function fetchModotTrafficCameras(context: LayerQueryContext, signal?: AbortSignal, fetcher: Fetcher = providerFetchWithTimeout): Promise<TrafficCamera[]> {
  const url = arcgisEnvelopeQueryUrl(MODOT_CAMERAS_URL, context.viewport);
  const json = await fetchJson(url, DEFAULT_PROVIDER_TIMEOUT_MS, signal, fetcher);
  const features = Array.isArray(json?.features) ? json.features : [];
  const cameras = features
    .map((feature: unknown) => normalizeModotCamera(feature, "modot-traveler"))
    .filter((camera: TrafficCamera | null): camera is TrafficCamera => camera != null)
    .slice(0, MAX_CAMERA_RESULTS);
  return dedupeById(cameras);
}

// --- Oklahoma DOT Work Zone Data Exchange -------------------------------------------------------
//
// ODOT publishes a public-domain (CC0) Work Zone Data Exchange (WZDx v4.0) feed at oktraffic.org,
// registered with USDOT's national WZDx Feed Registry for third-party consumption -- this is a
// federally-standardized open-data format, not a scrape. The registry-issued access token (a
// per-feed identifier the registry itself publishes so third parties can query it) is held
// server-side in functions/api/odot/[[path]].ts, not shipped in this client bundle.
//
// Confirmed via direct request: no `Access-Control-Allow-Origin` is returned for an arbitrary
// origin, so like MoDOT above, this is routed through the same-origin proxy Cloudflare Pages
// Function (server-to-server, no CORS, token injected there) rather than oktraffic.org directly.
// That function only exists on the web/ops deployment; elsewhere this relative path 404s, which
// the existing unavailable/stale path already handles honestly -- no regression, proxy-only gain.
//
// ODOT's public camera map (oktraffic.org's own SPA) sits behind a Cloudflare bot-management
// challenge with no separate public JSON endpoint found -- attempting to defeat that challenge
// would be circumventing an access control, which is out of scope. No Oklahoma camera provider is
// added this pass; ODOT road conditions are still covered via the WZDx feed below.
const ODOT_WZDX_BASE_URL = "/api/odot";
const ODOT_PUBLIC_MAP_URL = "https://oktraffic.org/";
// WZDx only carries "work-zone" events today; ODOT's feed registry does not expose a separate
// closures endpoint. Both feeds share this same set of two which mirrors what the state currently
// publishes.
const ODOT_WZDX_FEEDS: Array<{ path: string; kindHint: string }> = [
  { path: "workzones", kindHint: "construction" },
  { path: "closures", kindHint: "closure" },
];

function wzdxVehicleImpactToClosureState(vehicleImpact: unknown): RoadClosureState {
  const text = sanitizeProviderText(vehicleImpact, 40).toLowerCase();
  if (text === "all-lanes-closed") return "closed";
  if (text === "some-lanes-closed" || text === "alternating-one-way") return "lane-restricted";
  return "unknown";
}

function normalizeWzdxFeature(feature: unknown, providerId: string, kindHint: string): RoadConditionEvent | null {
  if (!feature || typeof feature !== "object") return null;
  const candidate = feature as { id?: unknown; properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } };
  const props = candidate.properties ?? {};
  const core = (props.core_details ?? {}) as Record<string, unknown>;
  const coords = candidate.geometry?.coordinates;
  const firstPoint = Array.isArray(coords) ? (coords.find((c) => Array.isArray(c) && c.length >= 2) as unknown) ?? coords[0] : null;
  const lon = Array.isArray(firstPoint) ? Number(firstPoint[0]) : NaN;
  const lat = Array.isArray(firstPoint) ? Number(firstPoint[1]) : NaN;
  if (!isValidCoordinate(lat, lon)) return null;
  const recordId = sanitizeProviderText(candidate.id ?? `${lat},${lon}`, 80);
  const roadNames = Array.isArray(core.road_names) ? core.road_names.map((v) => sanitizeProviderText(v, 30)).filter(Boolean) : [];
  const roadway = roadNames.join(" / ") || null;
  const description = sanitizeProviderText(core.description, 320);
  const vehicleImpact = props.vehicle_impact;
  const closureState = wzdxVehicleImpactToClosureState(vehicleImpact);
  const syntheticProps = { reason: description || kindHint, description, travel_impact: sanitizeProviderText(vehicleImpact, 40) };
  const kind = normalizeRoadKind(kindHint, syntheticProps);
  const severity = normalizeRoadSeverity(syntheticProps, closureState, kind);
  const updatedAt = parseProviderTime(core.update_date) ?? nowMs();
  const freshness = freshnessForTimestamp(updatedAt);
  return {
    id: `${providerId}:road:${recordId}`,
    providerId,
    providerRecordId: recordId,
    kind,
    geometry: { type: "point", lat, lon },
    closureState,
    severity,
    title: [roadway, description].filter(Boolean).join(" - ") || "Road condition",
    startsAt: parseProviderTime(props.start_date),
    endsAt: parseProviderTime(props.end_date),
    direction: normalizeDirection(core.direction),
    roadway,
    status: sanitizeProviderText(props.event_status ?? closureState, 80) || closureState,
    description,
    lat,
    lon,
    provider: ODOT_PROVENANCE,
    updatedAt,
    freshness,
    stale: freshness === "stale" || freshness === "unavailable",
    sourceUrl: ODOT_PUBLIC_MAP_URL,
    rawSourceReference: recordId,
  };
}

export async function fetchOdotRoadConditions(context: LayerQueryContext, signal?: AbortSignal, fetcher: Fetcher = providerFetchWithTimeout): Promise<RoadConditionEvent[]> {
  const results: RoadConditionEvent[] = [];
  for (const { path, kindHint } of ODOT_WZDX_FEEDS) {
    const url = `${ODOT_WZDX_BASE_URL}/${path}`;
    const json = await fetchJson(url, DEFAULT_PROVIDER_TIMEOUT_MS, signal, fetcher);
    const features = Array.isArray(json?.features) ? json.features : [];
    for (const feature of features) {
      const event = normalizeWzdxFeature(feature, "odot-wzdx", kindHint);
      if (event && pointInViewport(event, context.viewport)) results.push(event);
      if (results.length >= MAX_ROAD_RESULTS) break;
    }
  }
  return dedupeById(results).slice(0, MAX_ROAD_RESULTS);
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
  {
    id: "kandrive-kdot",
    name: "Kansas DOT KanDrive",
    coverage: KANSAS_COVERAGE,
    enabled: true,
    priority: 10,
    minRefreshMs: ROAD_CACHE_TTL_MS,
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    attribution: "Kansas DOT KanDrive",
    fetchViewport: fetchKandriveRoadConditions,
  },
  {
    id: "modot-traveler",
    name: "Missouri DOT Traveler Information",
    coverage: MISSOURI_COVERAGE,
    enabled: true,
    priority: 10,
    minRefreshMs: ROAD_CACHE_TTL_MS,
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    attribution: "Missouri DOT Traveler Information",
    fetchViewport: fetchModotRoadConditions,
  },
  {
    id: "odot-wzdx",
    name: "Oklahoma DOT Work Zone Data Exchange",
    coverage: OKLAHOMA_COVERAGE,
    enabled: true,
    priority: 10,
    minRefreshMs: ROAD_CACHE_TTL_MS,
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    attribution: "Oklahoma DOT Work Zone Data Exchange",
    fetchViewport: fetchOdotRoadConditions,
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
  {
    id: "kandrive-kdot",
    name: "Kansas DOT KanDrive",
    coverage: KANSAS_COVERAGE,
    enabled: true,
    priority: 10,
    minRefreshMs: CAMERA_CACHE_TTL_MS,
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    attribution: "Kansas DOT KanDrive",
    fetchViewport: fetchKandriveTrafficCameras,
  },
  {
    id: "modot-traveler",
    name: "Missouri DOT Traveler Information",
    coverage: MISSOURI_COVERAGE,
    enabled: true,
    priority: 10,
    minRefreshMs: CAMERA_CACHE_TTL_MS,
    timeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    attribution: "Missouri DOT Traveler Information",
    fetchViewport: fetchModotTrafficCameras,
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
    return { data: [], status: "outside-coverage", message: "Outside current road-condition provider coverage. Supports Arkansas, Kansas, Missouri, and Oklahoma DOT coverage.", simulated: false, fetchedAt };
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
    return { data: [], status: "outside-coverage", message: "Outside current public-camera provider coverage. Supports Arkansas, Kansas, and Missouri DOT coverage.", simulated: false, fetchedAt };
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
