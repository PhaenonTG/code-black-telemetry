import { distanceMiles, readNumber } from "./telemetry/quality";
import { Preferences } from "@capacitor/preferences";
import { mapboxReverseGeocodeUrl } from "./mapTiles";

export interface AlertProduct {
  id: string;
  type: "warning" | "watch" | "statement" | "md";
  severity: "tornado" | "severe" | "flash-flood" | "pds" | "md" | "watch" | "other";
  title: string;
  headline: string;
  description: string;
  instruction: string;
  area: string;
  sent: string;
  expires: string;
  source: string;
  url?: string;
  watchProbability?: string;
  relatedWatch?: string;
  insideText?: string;
}

export interface ExternalObservation {
  station: string;
  name: string;
  distanceMi: number;
  tempF: number | null;
  dewpointF: number | null;
  humidity: number | null;
  pressureMb: number | null;
  windSpeedMph: number | null;
  windGustMph: number | null;
  windDirectionDeg: number | null;
  updatedAt: number;
}

export interface LocalityResult {
  displayName: string;
  county: string;
  state: string;
  source: "pi" | "mapbox" | "nws" | "last-known" | "coordinates";
  updatedAt: number;
  lat: number;
  lon: number;
}

type Position = { lat: number; lon: number };

const ALERT_CACHE_MS = 60_000;
const MD_CACHE_MS = 5 * 60_000;
const OBS_CACHE_MS = 5 * 60_000;
const LOCALITY_CACHE_MS = 10 * 60_000;
const LOCALITY_MOVE_MI = 4;
const LOCALITY_BACKOFF_MS = 2 * 60_000;

const cache = new Map<string, { expires: number; value: unknown }>();
const LAST_ALERTS_KEY = "codeblack.lastAlerts";
const LAST_MDS_KEY = "codeblack.lastMesoscaleDiscussions";
const LAST_OBS_KEY = "codeblack.lastExternalObservation";
const LAST_LOCALITY_KEY = "codeblack.lastLocality";
let lastLocalityFailureAt = 0;

async function saveNativeCache<T>(key: string, value: T) {
  await Preferences.set({ key, value: JSON.stringify(value) });
}

async function readNativeCache<T>(key: string, fallback: T): Promise<T> {
  const saved = await Preferences.get({ key });
  if (!saved.value) return fallback;
  try {
    return JSON.parse(saved.value) as T;
  } catch {
    return fallback;
  }
}

async function fetchJson<T>(url: string, timeoutMs = 4500): Promise<T> {
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value as T;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/geo+json, application/json" },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const value = (await response.json()) as T;
    const ttl = url.includes("spc_mesoscale") ? MD_CACHE_MS : url.includes("observations/latest") ? OBS_CACHE_MS : ALERT_CACHE_MS;
    cache.set(url, { expires: Date.now() + ttl, value });
    return value;
  } finally {
    window.clearTimeout(timer);
  }
}

function classifyAlert(event = "", headline = ""): AlertProduct["severity"] {
  const text = `${event} ${headline}`.toLowerCase();
  if (text.includes("pds") || text.includes("particularly dangerous")) return "pds";
  if (text.includes("tornado warning")) return "tornado";
  if (text.includes("severe thunderstorm warning")) return "severe";
  if (text.includes("flash flood warning")) return "flash-flood";
  if (text.includes("watch")) return "watch";
  return "other";
}

export async function getNwsAlerts(pos: Position): Promise<AlertProduct[]> {
  const url = `https://api.weather.gov/alerts/active?point=${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
  try {
    const data = await fetchJson<{ features?: Array<{ id: string; properties?: Record<string, string> }> }>(url);
    const products = (data.features ?? []).map((feature) => {
      const p = feature.properties ?? {};
      const severity = classifyAlert(p.event, p.headline);
      const type: AlertProduct["type"] = p.event?.toLowerCase().includes("watch")
        ? "watch"
        : p.event?.toLowerCase().includes("statement") || p.event?.toLowerCase().includes("advisory")
          ? "statement"
          : "warning";
      return {
        id: feature.id,
        type,
        severity,
        title: p.event ?? "NWS Product",
        headline: p.headline ?? p.event ?? "Active NWS product",
        description: p.description ?? "",
        instruction: p.instruction ?? "",
        area: p.areaDesc ?? "",
        sent: p.sent ?? "",
        expires: p.expires ?? p.ends ?? "",
        source: "NWS",
      } satisfies AlertProduct;
    }).filter((alert) => ["tornado", "severe", "flash-flood", "pds", "watch", "other"].includes(alert.severity)).slice(0, 8);
    await saveNativeCache(LAST_ALERTS_KEY, products);
    return products;
  } catch {
    return readNativeCache<AlertProduct[]>(LAST_ALERTS_KEY, []);
  }
}

function pointInRing(point: Position, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > point.lat !== yj > point.lat && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Position, coordinates: unknown): boolean {
  if (!Array.isArray(coordinates)) return false;
  const polygons = typeof coordinates[0]?.[0]?.[0] === "number" ? [coordinates] : coordinates;
  return polygons.some((polygon: unknown) => Array.isArray(polygon) && pointInRing(point, polygon[0] as number[][]));
}

function mdNumber(props: Record<string, unknown>) {
  return String(props.MDNUM ?? props.mdnum ?? props.DISCUSSION ?? props.id ?? "").replace(/\D/g, "");
}

export async function getActiveMesoscaleDiscussions(pos: Position): Promise<AlertProduct[]> {
  const url =
    "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query?where=1%3D1&outFields=*&f=geojson";
  try {
    const data = await fetchJson<{ features?: Array<{ geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }> }>(url);
    const matches = (data.features ?? []).filter((feature) => pointInPolygon(pos, feature.geometry?.coordinates));
    const products = await Promise.all(
    matches.slice(0, 6).map(async (feature, index) => {
      const props = feature.properties ?? {};
      const number = mdNumber(props) || String(index + 1);
      const title = String(props.CONCERNING ?? props.concerning ?? props.TITLE ?? props.label ?? `Mesoscale Discussion ${number}`);
      const issued = String(props.ISSUE ?? props.ISSUED ?? props.issue ?? props.VALID ?? "");
      const expires = String(props.EXPIRE ?? props.EXPIRES ?? props.expire ?? "");
      const url = `https://www.spc.noaa.gov/products/md/md${number}.html`;
      let description = String(props.DISCUSSION ?? props.description ?? title);
      try {
        const text = await fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
        const match = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (match?.[1]) description = match[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
      } catch {
        // Polygon metadata remains usable if SPC discussion text is blocked by CORS or network.
      }
      return {
        id: `spc-md-${number}`,
        type: "md",
        severity: "md",
        title: `MD ${number}`,
        headline: title,
        description,
        instruction: "",
        area: String(props.AREA ?? props.area ?? ""),
        sent: issued,
        expires,
        source: "SPC",
        url,
        watchProbability: String(props.WATCH_PROB ?? props.watch_prob ?? ""),
        relatedWatch: String(props.WATCH ?? props.watch ?? ""),
        insideText: `YOU ARE INSIDE MD ${number}`,
      } satisfies AlertProduct;
    }),
    );
    await saveNativeCache(LAST_MDS_KEY, products);
    return products;
  } catch {
    return readNativeCache<AlertProduct[]>(LAST_MDS_KEY, []);
  }
}

function cToF(c: number | null) {
  return c === null ? null : (c * 9) / 5 + 32;
}

function msToMph(ms: number | null) {
  return ms === null ? null : ms * 2.23694;
}

export async function getNearestObservation(pos: Position): Promise<ExternalObservation | null> {
  const points = await fetchJson<{ properties?: { observationStations?: string } }>(`https://api.weather.gov/points/${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`);
  const stationsUrl = points.properties?.observationStations;
  if (!stationsUrl) return null;
  const stations = await fetchJson<{ features?: Array<{ id: string; geometry?: { coordinates?: [number, number] }; properties?: { stationIdentifier?: string; name?: string } }> }>(
    stationsUrl,
  );
  const sorted = (stations.features ?? [])
    .map((station) => {
      const coords = station.geometry?.coordinates;
      const stationPos = Array.isArray(coords) && Number.isFinite(coords[0]) && Number.isFinite(coords[1]) ? { lon: coords[0], lat: coords[1] } : null;
      return { station, distanceMi: stationPos ? distanceMiles(pos, stationPos) : Number.POSITIVE_INFINITY };
    })
    .filter((item) => Number.isFinite(item.distanceMi))
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, 3);

  for (const item of sorted) {
    const stationUrl = `${item.station.id}/observations/latest`;
    try {
      const obs = await fetchJson<{ properties?: Record<string, unknown> }>(stationUrl);
      const p = obs.properties ?? {};
      const external = {
        station: item.station.properties?.stationIdentifier ?? item.station.id.split("/").pop() ?? "NWS",
        name: item.station.properties?.name ?? "Nearest NWS station",
        distanceMi: item.distanceMi,
        tempF: cToF(readNumber(p.temperature, ["value"])),
        dewpointF: cToF(readNumber(p.dewpoint, ["value"])),
        humidity: readNumber(p.relativeHumidity, ["value"]),
        pressureMb: readNumber(p.barometricPressure, ["value"]) !== null ? readNumber(p.barometricPressure, ["value"])! / 100 : null,
        windSpeedMph: msToMph(readNumber(p.windSpeed, ["value"])),
        windGustMph: msToMph(readNumber(p.windGust, ["value"])),
        windDirectionDeg: readNumber(p.windDirection, ["value"]),
        updatedAt: Date.parse(String(p.timestamp ?? "")) || Date.now(),
      };
      await saveNativeCache(LAST_OBS_KEY, external);
      return external;
    } catch {
      // Try the next closest station.
    }
  }
  return readNativeCache<ExternalObservation | null>(LAST_OBS_KEY, null);
}

function stateAbbr(value = "") {
  const upper = value.trim().toUpperCase();
  const map: Record<string, string> = {
    ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT",
    DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA",
    KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI",
    MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH",
    "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH",
    OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
    TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",
    WISCONSIN: "WI", WYOMING: "WY",
  };
  return upper.length === 2 ? upper : map[upper] ?? upper;
}

function coordinateLocality(pos: Position): LocalityResult {
  return {
    displayName: `${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}`,
    county: "LOCALITY UNAVAILABLE",
    state: "",
    source: "coordinates",
    updatedAt: Date.now(),
    lat: pos.lat,
    lon: pos.lon,
  };
}

function parseMapboxLocality(data: unknown, pos: Position): LocalityResult | null {
  const features = (data as { features?: Array<Record<string, unknown>> }).features ?? [];
  const feature = features[0];
  if (!feature) return null;
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const context = (props.context ?? {}) as Record<string, { name?: string; region_code?: string; region_code_full?: string }>;
  const city = String(props.name ?? context.place?.name ?? context.locality?.name ?? context.neighborhood?.name ?? "").trim();
  const state = stateAbbr(context.region?.region_code ?? context.region?.name ?? "");
  const countyName = String(context.district?.name ?? "").replace(/\s+County$/i, "").trim();
  if (!city && !state && !countyName) return null;
  return {
    displayName: `${city ? `NEAR ${city.toUpperCase()}` : "CURRENT POSITION"}${state ? `, ${state}` : ""}`,
    county: countyName ? `${countyName.toUpperCase()} COUNTY` : "COUNTY UNAVAILABLE",
    state,
    source: "mapbox",
    updatedAt: Date.now(),
    lat: pos.lat,
    lon: pos.lon,
  };
}

function parseNwsLocality(data: unknown, pos: Position): LocalityResult | null {
  const p = (data as { properties?: Record<string, unknown> }).properties ?? {};
  const relative = p.relativeLocation as { properties?: Record<string, unknown> } | undefined;
  const city = String(relative?.properties?.city ?? "").trim();
  const state = stateAbbr(String(relative?.properties?.state ?? ""));
  const county = String(p.county ?? "").split("/").pop()?.replace(/\s+County$/i, "") ?? "";
  if (!city && !state && !county) return null;
  return {
    displayName: `${city ? `NEAR ${city.toUpperCase()}` : "CURRENT POSITION"}${state ? `, ${state}` : ""}`,
    county: county ? `${county.toUpperCase()} COUNTY` : "COUNTY UNAVAILABLE",
    state,
    source: "nws",
    updatedAt: Date.now(),
    lat: pos.lat,
    lon: pos.lon,
  };
}

export async function getReverseLocality(pos: Position): Promise<LocalityResult> {
  const cached = await readNativeCache<LocalityResult | null>(LAST_LOCALITY_KEY, null);
  if (cached) {
    const age = Date.now() - cached.updatedAt;
    const moved = distanceMiles(pos, cached);
    if (age < LOCALITY_CACHE_MS && moved < LOCALITY_MOVE_MI) return cached;
    if (Date.now() - lastLocalityFailureAt < LOCALITY_BACKOFF_MS && moved < LOCALITY_MOVE_MI * 2) return { ...cached, source: "last-known" };
  }

  const mapboxUrl = mapboxReverseGeocodeUrl(pos.lat, pos.lon);
  if (mapboxUrl) {
    try {
      const locality = parseMapboxLocality(await fetchJson<unknown>(mapboxUrl, 4500), pos);
      if (locality) {
        await saveNativeCache(LAST_LOCALITY_KEY, locality);
        return locality;
      }
    } catch {
      lastLocalityFailureAt = Date.now();
    }
  }

  try {
    const locality = parseNwsLocality(await fetchJson<unknown>(`https://api.weather.gov/points/${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`, 4500), pos);
    if (locality) {
      await saveNativeCache(LAST_LOCALITY_KEY, locality);
      return locality;
    }
  } catch {
    lastLocalityFailureAt = Date.now();
  }

  if (cached && distanceMiles(pos, cached) < LOCALITY_MOVE_MI * 5) return { ...cached, source: "last-known" };
  return coordinateLocality(pos);
}

export async function getRadarTileTemplate(): Promise<string | null> {
  try {
    const data = await fetchJson<{ radar?: { past?: Array<{ path: string }> } }>("https://api.rainviewer.com/public/weather-maps.json", 5000);
    const latest = data.radar?.past?.at(-1)?.path;
    return latest ? `https://tilecache.rainviewer.com${latest}/256/{z}/{x}/{y}/2/1_1.png` : null;
  } catch {
    return null;
  }
}
