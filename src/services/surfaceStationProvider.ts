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

export async function getSurfaceStationsForViewport(context: LayerQueryContext, signal?: AbortSignal): Promise<ViewportLayerResult<SurfaceStationObservation>> {
  const { viewport } = context;
  const key = viewportCacheKey(viewport);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { data: cached.value, status: cached.value.length ? "ready" : "empty", message: "", simulated: false, fetchedAt: Date.now(), providerIds: ["nws-asos"] };
  }
  let pending = inFlight.get(key);
  if (!pending) {
    const centerLat = (viewport.north + viewport.south) / 2;
    const centerLon = (viewport.east + viewport.west) / 2;
    pending = fetchStationsForCenter(centerLat, centerLon, signal)
      .then((data) => {
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
    return { data, status: data.length ? "ready" : "empty", message: data.length ? "" : "No nearby stations reported.", simulated: false, fetchedAt: Date.now(), providerIds: ["nws-asos"] };
  } catch {
    return { data: [], status: "error", message: "NWS surface obs request failed.", simulated: false, fetchedAt: Date.now(), providerIds: ["nws-asos"] };
  }
}
