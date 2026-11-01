import type { PublicHurricane } from "./types";
import type { NwsAlert } from "./nwsAlerts";

export type CameraRole = "west" | "near" | "east";
export type CoastCamera = {
  id: string; name: string; latitude: number; longitude: number;
  source: string; provider: string; outlook: string;
  role?: CameraRole;
};

// Only sources with direct advancing HLS video are eligible for automatic
// playback. YouTube's "Live" flag remained true while embedded video froze.
// Coordinates describe areas, not surveyed lens positions or bearings.
export const coastCameras: CoastCamera[] = [
  { id: "waveland", name: "Waveland, MS", latitude: 30.25, longitude: -89.4, source: "https://www.wxxv25.com/weather-cameras/", provider: "WXXV", outlook: "Mississippi coast" },
  { id: "bay-st-louis", name: "Bay St. Louis, MS", latitude: 30.31, longitude: -89.33, source: "https://www.wxxv25.com/weather-cameras/", provider: "WXXV", outlook: "Bay / coast" },
  { id: "biloxi-west", name: "West Biloxi, MS", latitude: 30.39, longitude: -88.9, source: "https://www.wxxv25.com/weather-cameras/", provider: "WXXV", outlook: "Grand Bay area reference" },
  { id: "gulf-shores", name: "Gulf Shores, AL", latitude: 30.25, longitude: -87.7, source: "https://www.brett-robinson.com/webcams/", provider: "Brett / Phoenix Gulf Towers", outlook: "Gulf-facing beach" },
];

type Point = { latitude: number; longitude: number };
const miles = (a: Point, b: Point) => {
  const dLat = (a.latitude - b.latitude) * 69;
  const dLon = (a.longitude - b.longitude) * 69 * Math.cos(a.latitude * Math.PI / 180);
  return Math.hypot(dLat, dLon);
};

export function projectedCoast(data: PublicHurricane): Point | null {
  const points = data.projection.points.length ? data.projection.points : data.official.track;
  if (!points.length) return null;
  const coastLatitude = 30.25;
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1], after = points[i];
    if (before.latitude <= coastLatitude && after.latitude >= coastLatitude && after.latitude !== before.latitude) {
      const part = (coastLatitude - before.latitude) / (after.latitude - before.latitude);
      return { latitude: coastLatitude, longitude: before.longitude + (after.longitude - before.longitude) * part };
    }
  }
  const nearest = [...points].sort((a, b) => Math.abs(a.latitude - coastLatitude) - Math.abs(b.latitude - coastLatitude))[0];
  return { latitude: nearest.latitude, longitude: nearest.longitude };
}

function alertPoints(alert: NwsAlert): Point[] {
  const result: Point[] = [];
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") result.push({ longitude: value[0], latitude: value[1] });
    else value.forEach(walk);
  };
  walk(alert.geometry?.coordinates);
  return result;
}

function warningCamera(alerts: NwsAlert[]): CoastCamera | null {
  const prioritized = alerts.filter((alert) => /^(tornado warning|severe thunderstorm warning)$/i.test(alert.properties?.event ?? ""))
    .sort((a, b) => Number(/tornado/i.test(b.properties?.event ?? "")) - Number(/tornado/i.test(a.properties?.event ?? "")));
  for (const alert of prioritized) {
    const points = alertPoints(alert);
    if (!points.length) continue;
    const closest = coastCameras.map((camera) => ({ camera, distance: Math.min(...points.map((point) => miles(camera, point))) })).sort((a, b) => a.distance - b.distance)[0];
    if (closest.distance <= 60) return closest.camera;
  }
  return null;
}

export function selectCameras(data: PublicHurricane, alerts: NwsAlert[]) {
  const target = projectedCoast(data);
  if (!target) return { center: null, dynamic: [], fixed: [], target: null };
  const nearest = [...coastCameras].sort((a, b) => miles(a, target) - miles(b, target));
  const center = nearest[0];
  const dynamic: CoastCamera[] = nearest.slice(0, 3).map((camera) => ({ ...camera,
    role: camera.id === center.id ? "near" : camera.longitude < target.longitude ? "west" : "east" }));
  const storm = data.storm.center;
  const coastalPassageLikely = data.status === "post_storm_watch" || (storm.latitude != null && storm.longitude != null && storm.latitude >= 30.1 && storm.longitude >= -90.5 && storm.longitude <= -86.5);
  const warning = coastalPassageLikely ? warningCamera(alerts) : null;
  if (warning && !dynamic.some((camera) => camera.id === warning.id))
    dynamic[dynamic.length - 1] = { ...warning, role: warning.longitude < target.longitude ? "west" : "east" };
  return { center: dynamic.find((camera) => camera.role === "near") ?? dynamic[0] ?? null, dynamic, fixed: [], target };
}
