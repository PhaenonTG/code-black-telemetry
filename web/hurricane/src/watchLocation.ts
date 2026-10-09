import type { PublicHurricane, TrackPoint, ProjectionPoint } from "./types";

export type WatchLocation = { label: string; latitude: number; longitude: number };
export type PointAlert = { event: string; headline: string; severity: string | null; expires: string | null; url: string | null };
export const DEFAULT_WATCH: WatchLocation = {
  label: "Grand Bay, Alabama",
  latitude: 30.447577800627,
  longitude: -88.329515563521,
};

export function distanceMiles(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians;
  const lon = (b.longitude - a.longitude) * radians;
  const value = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lon / 2) ** 2;
  return Math.round(3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)));
}

export function closestPoint<T extends TrackPoint | ProjectionPoint>(points: T[], watch: WatchLocation): { point: T; miles: number } | null {
  const valid = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!valid.length) return null;
  return valid.map((point) => ({ point, miles: distanceMiles(point, watch) })).sort((a, b) => a.miles - b.miles)[0];
}

export function watchSummary(data: PublicHurricane, watch: WatchLocation) {
  const center = data.storm.center;
  return {
    currentMiles: center.latitude == null || center.longitude == null ? null : distanceMiles({ latitude: center.latitude, longitude: center.longitude }, watch),
    official: closestPoint(data.official.track, watch),
    aegis: closestPoint(data.projection.points, watch),
  };
}

export async function fetchPointAlerts(watch: WatchLocation, signal: AbortSignal): Promise<PointAlert[]> {
  const url = new URL("https://api.weather.gov/alerts/active");
  url.searchParams.set("point", `${watch.latitude.toFixed(4)},${watch.longitude.toFixed(4)}`);
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: "application/geo+json" } });
    if (response.status >= 500 || response.status === 429) throw new Error(`NWS alerts returned ${response.status}`);
  } catch (cause) {
    if (signal.aborted) throw cause;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 1500);
      const onAbort = () => { window.clearTimeout(timer); reject(signal.reason); };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    response = await fetch(url, { signal, headers: { Accept: "application/geo+json" } });
  }
  if (!response.ok) throw new Error(`NWS alerts returned ${response.status}`);
  const body = await response.json() as { features?: { id?: string; properties?: Record<string, unknown> }[] };
  return (body.features ?? []).map((feature) => {
    const value = feature.properties ?? {};
    return {
      event: typeof value.event === "string" ? value.event : "Weather alert",
      headline: typeof value.headline === "string" ? value.headline : "Read the official alert for details.",
      severity: typeof value.severity === "string" ? value.severity : null,
      expires: typeof value.expires === "string" ? value.expires : null,
      url: typeof value.id === "string" && value.id.startsWith("https://api.weather.gov/") ? value.id :
        typeof feature.id === "string" && feature.id.startsWith("https://api.weather.gov/") ? feature.id : null,
    };
  });
}
