import type { LayerQueryContext, ObservationProvenance, SurfaceStationObservation, ViewportLayerResult } from "./mapLayerModels";
import type { MapViewport } from "../map/viewport";

const NWS_PROVENANCE: ObservationProvenance = {
  provider: "NWS/SURFACE_OBS",
  sourceId: "nws-asos",
  sourceName: "NWS/ASOS Surface Observations",
  official: true,
  experimental: false,
  displayLabel: "NWS Surface Obs",
};
const IOWA_RWIS_PROVENANCE: ObservationProvenance = { provider: "OFFICIAL/STATE_TRANSPORTATION", sourceId: "iadot-rwis", sourceName: "Iowa DOT RWIS", official: true, experimental: false, displayLabel: "Iowa DOT RWIS" };
const IOWA_RWIS_URL = "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/RWIS_Atmospheric_Data_View/FeatureServer/0/query";

const CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_STATIONS = 40;

const cache = new Map<string, { expires: number; value: SurfaceStationObservation[] }>();
const inFlight = new Map<string, Promise<SurfaceStationObservation[]>>();

function cToF(c: number | null): number | null {
  return c === null ? null : Math.round((c * 9) / 5 + 32);
}

function msToMph(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms * 2.23694);
}

function readNum(field: unknown): number | null {
  if (field && typeof field === "object" && "value" in (field as Record<string, unknown>)) {
    const v = (field as Record<string, unknown>).value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}

function freshnessFor(observedAt: number | null): SurfaceStationObservation["freshness"] {
  if (!observedAt) return "unavailable";
  const age = Date.now() - observedAt;
  if (age <= 20 * 60_000) return "fresh";
  if (age <= 60 * 60_000) return "aging";
  return "stale";
}

async function fetchTimeout(url: string, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/geo+json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

// One coarse cache bucket per (roughly) 50-100mi cell -- a vehicle moving within that area reuses
// the same nearby-station list rather than re-querying api.weather.gov on every viewport nudge.
function viewportCacheKey(viewport: MapViewport): string {
  const bucket = viewport.zoom >= 8 ? 0.5 : 1.5;
  const centerLat = (viewport.north + viewport.south) / 2;
  const centerLon = (viewport.east + viewport.west) / 2;
  return `${Math.round(centerLat / bucket)}:${Math.round(centerLon / bucket)}`;
}

async function fetchStationsForCenter(lat: number, lon: number, signal?: AbortSignal): Promise<SurfaceStationObservation[]> {
  const points = await fetchTimeout(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, signal);
  const stationsUrl = points?.properties?.observationStations;
  if (!stationsUrl) return [];
  const stationsData = await fetchTimeout(stationsUrl, signal);
  const features: any[] = Array.isArray(stationsData?.features) ? stationsData.features : [];
  const candidates = features.slice(0, MAX_STATIONS);
  const results = await Promise.all(
    candidates.map(async (feature): Promise<SurfaceStationObservation | null> => {
      const coords = feature?.geometry?.coordinates;
      const stationLat = Array.isArray(coords) ? coords[1] : null;
      const stationLon = Array.isArray(coords) ? coords[0] : null;
      if (typeof stationLat !== "number" || typeof stationLon !== "number") return null;
      const stationId: string = feature?.properties?.stationIdentifier ?? String(feature?.id ?? "").split("/").pop() ?? "NWS";
      try {
        const obs = await fetchTimeout(`${feature.id}/observations/latest`, signal);
        const p = obs?.properties ?? {};
        const observedAt = Date.parse(String(p.timestamp ?? "")) || null;
        const freshness = freshnessFor(observedAt);
        return {
          id: stationId,
          name: feature?.properties?.name ?? stationId,
          lat: stationLat,
          lon: stationLon,
          temperatureF: cToF(readNum(p.temperature)),
          dewpointF: cToF(readNum(p.dewpoint)),
          windSpeedMph: msToMph(readNum(p.windSpeed)),
          observedAt,
          freshness,
          stale: freshness === "stale" || freshness === "unavailable",
          provider: NWS_PROVENANCE,
        };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is SurfaceStationObservation => r !== null);
}

function validRwisNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) < 999 ? number : null;
}

async function fetchIowaRwis(viewport: MapViewport, signal?: AbortSignal): Promise<SurfaceStationObservation[]> {
  if (viewport.east < -96.64 || viewport.west > -90.14 || viewport.north < 40.36 || viewport.south > 43.51) return [];
  const params = new URLSearchParams({ f: "geojson", where: "STATUS=1", outFields: "*", geometry: `${viewport.west},${viewport.south},${viewport.east},${viewport.north}`, geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", returnGeometry: "true", resultRecordCount: "500" });
  const body = await fetchTimeout(`${IOWA_RWIS_URL}?${params}`, signal);
  return (body?.features ?? []).flatMap((feature: any) => {
    const coordinates = feature?.geometry?.coordinates;
    const p = feature?.properties ?? {};
    const lat = Number(coordinates?.[1] ?? p.LATITUDE); const lon = Number(coordinates?.[0] ?? p.LONGITUDE);
    const observedAt = Number(p.DATA_LAST_UPDATED);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(observedAt)) return [];
    const freshness = freshnessFor(observedAt);
    const visibility = validRwisNumber(p.VISIBILITY);
    return [{ id: `IA-${p.SITE_NUMBER ?? p.OBJECTID}`, name: p.RPUID_NAME ?? "Iowa RWIS", lat, lon, temperatureF: validRwisNumber(p.AIR_TEMP), dewpointF: validRwisNumber(p.DEW_POINT), windSpeedMph: validRwisNumber(p.AVG_WINDSPEED_MPH), windGustMph: validRwisNumber(p.MAX_WINDSPEED_MPH), visibilityMiles: visibility, precipitationType: p.PRECIPITATION_TYPE && p.PRECIPITATION_TYPE !== "NA" ? String(p.PRECIPITATION_TYPE) : null, roadway: p.ROUTE_NAME ? `${p.ROUTE_NAME}${p.MILE_POST != null ? ` MM ${p.MILE_POST}` : ""}` : null, observedAt, freshness, stale: freshness === "stale" || freshness === "unavailable", provider: IOWA_RWIS_PROVENANCE }];
  });
}

export async function getSurfaceStationsForViewport(context: LayerQueryContext, signal?: AbortSignal): Promise<ViewportLayerResult<SurfaceStationObservation>> {
  const { viewport } = context;
  const key = viewportCacheKey(viewport);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { data: cached.value, status: cached.value.length ? "ready" : "empty", message: "", simulated: false, fetchedAt: Date.now(), providerIds: ["nws-asos", "iadot-rwis"] };
  }
  let pending = inFlight.get(key);
  if (!pending) {
    const centerLat = (viewport.north + viewport.south) / 2;
    const centerLon = (viewport.east + viewport.west) / 2;
    pending = Promise.allSettled([fetchStationsForCenter(centerLat, centerLon, signal), fetchIowaRwis(viewport, signal)])
      .then((results) => {
        const data = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
        cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value: data });
        return data;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, pending);
  }
  try {
    const data = await pending;
    return { data, status: data.length ? "ready" : "empty", message: data.length ? "" : "No nearby stations reported.", simulated: false, fetchedAt: Date.now(), providerIds: ["nws-asos", "iadot-rwis"] };
  } catch {
    return { data: [], status: "error", message: "NWS surface obs request failed.", simulated: false, fetchedAt: Date.now(), providerIds: ["nws-asos"] };
  }
}
