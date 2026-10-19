import type { AlertGeometry } from "./situational";

export interface WatchPolygon {
  id: string; // Matches AlertProduct.id (both are the NWS CAP URN) so a map click can correlate
  // back to the richer alert already fetched via getNwsAlerts() -- same product, two data sources.
  prodType: string;
  expires: string;
  geometry: AlertGeometry;
}

// api.weather.gov's own /alerts endpoint returns null geometry for watches -- confirmed live, and
// documented as expected/correct upstream behavior: since 2006 a watch's *official* area is a
// county/zone list, not a drawn polygon, so there's no single authoritative shape to hand back.
// This NWS-operated ArcGIS service (the same one Watch/Warning/Advisory viewers like the National
// Weather Service's own web map use) publishes the practical polygon anyway -- the shape drawn for
// public display, keyed by the same CAP id as the alerts API. Nationwide fetch, no geographic
// filter: simultaneous active tornado/severe thunderstorm watches are rare enough (typically single
// digits, a few dozen at most during a major outbreak) that this stays a small, cheap query, and it
// keeps "what's active" always complete rather than depending on getting a search radius right.
const WATCHES_URL =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query" +
  "?where=sig%3D%27A%27+AND+phenom+IN+%28%27TO%27%2C%27SV%27%29&outFields=prod_type,expiration,cap_id&f=geojson";

export async function getActiveWatchPolygons(): Promise<WatchPolygon[]> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(WATCHES_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = (await response.json()) as {
      features?: Array<{ geometry?: AlertGeometry | null; properties?: Record<string, string> }>;
    };
    return (data.features ?? [])
      .filter((feature): feature is { geometry: AlertGeometry; properties: Record<string, string> } =>
        Boolean(feature.geometry && feature.properties?.cap_id),
      )
      .map((feature) => ({
        id: feature.properties.cap_id,
        prodType: feature.properties.prod_type ?? "Watch",
        expires: feature.properties.expiration ?? "",
        geometry: feature.geometry,
      }));
  } catch {
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}
