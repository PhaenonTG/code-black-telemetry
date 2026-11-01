import type { PublicHurricane, TrackPoint, ProjectionPoint } from "./types";

export type WatchLocation = { label: string; latitude: number; longitude: number };
export type PointAlert = { event: string; headline: string; description: string | null; severity: string | null; onset: string | null; ends: string | null; expires: string | null; url: string | null; sent?: string | null; area?: string | null };
export const DEFAULT_WATCH: WatchLocation = {
  label: "Grand Bay, AL",
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

/** Bearing from the watch location toward the storm center, clockwise from true north. */
export function bearingToCenter(watch: WatchLocation, center: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180;
  const latitudeA = watch.latitude * radians, latitudeB = center.latitude * radians;
  const longitudeDelta = (center.longitude - watch.longitude) * radians;
  const east = Math.sin(longitudeDelta) * Math.cos(latitudeB);
  const north = Math.cos(latitudeA) * Math.sin(latitudeB) - Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta);
  const degrees = Math.round((Math.atan2(east, north) / radians + 360) % 360);
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return { degrees, direction: directions[Math.round(degrees / 22.5) % 16] };
}

export function closestPoint<T extends TrackPoint | ProjectionPoint>(points: T[], watch: WatchLocation): { point: T; miles: number } | null {
  const valid = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!valid.length) return null;
  return valid.map((point) => ({ point, miles: distanceMiles(point, watch) })).sort((a, b) => a.miles - b.miles)[0];
}

export function watchSummary(data: PublicHurricane, watch: WatchLocation) {
  const center = data.storm.center;
  const validCenter = center.latitude == null || center.longitude == null ? null : { latitude: center.latitude, longitude: center.longitude };
  return {
    currentMiles: validCenter ? distanceMiles(validCenter, watch) : null,
    centerBearing: validCenter ? bearingToCenter(watch, validCenter) : null,
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
  const rows = (body.features ?? []).map((feature) => {
    const value = feature.properties ?? {};
    return {
      event: typeof value.event === "string" ? value.event : "Weather alert",
      headline: typeof value.headline === "string" ? value.headline : "Read the official alert for details.",
      description: typeof value.description === "string" ? value.description.slice(0, 12000) : null,
      severity: typeof value.severity === "string" ? value.severity : null,
      onset: typeof value.onset === "string" ? value.onset : null,
      ends: typeof value.ends === "string" ? value.ends : null,
      expires: typeof value.expires === "string" ? value.expires : null,
      sent: typeof value.sent === "string" ? value.sent : null,
      area: typeof value.areaDesc === "string" ? value.areaDesc : null,
      url: `https://forecast.weather.gov/showsigwx.php?warnzone=${encodeURIComponent(String((value.geocode as { UGC?: string[] } | undefined)?.UGC?.[0] ?? ""))}&warncounty=&firewxzone=&local_place1=${encodeURIComponent(watch.label)}&product1=${encodeURIComponent(String(value.event ?? "Weather alert"))}&lat=${watch.latitude}&lon=${watch.longitude}`,
    };
  });
  const latest = new Map<string, PointAlert>();
  for (const row of rows) {
    const key = `${row.event}|${row.area ?? ""}`;
    const old = latest.get(key);
    if(!old || Date.parse(row.sent ?? "") > Date.parse(old.sent ?? "")) latest.set(key,row);
  }
  return [...latest.values()];
}

export function savedWatch(): WatchLocation {
  try { const value=JSON.parse(localStorage.getItem("tropics-watch") ?? "null");
    if(value && typeof value.label==="string" && value.label.length<=256 && Number.isFinite(value.latitude) && Math.abs(value.latitude)<=90 && Number.isFinite(value.longitude) && Math.abs(value.longitude)<=180) return value;
  } catch { /* Storage is optional. */ }
  return DEFAULT_WATCH;
}
