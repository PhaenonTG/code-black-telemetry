import type { PublicHurricane } from "./types";
import type { NwsAlert } from "./nwsAlerts";

export type CoastCamera = {
  id: string; name: string; latitude: number; longitude: number;
  embed: string; source: string; provider: string; outlook: string;
};

// Only provider-published live embeds are used. Coordinates describe the general
// camera area, not a surveyed lens position or a verified bearing.
export const coastCameras: CoastCamera[] = [
  { id: "waveland", name: "Waveland, MS", latitude: 30.25, longitude: -89.4, embed: "https://api.wetmet.net/widgets/stream/frame.php?uid=4f70bbceee1ebd135dfd11cd9eff155f", source: "https://www.wxxv25.com/weather-cameras/", provider: "WXXV", outlook: "Mississippi coast" },
  { id: "bay-st-louis", name: "Bay St. Louis, MS", latitude: 30.31, longitude: -89.33, embed: "https://api.wetmet.net/widgets/stream/frame.php?uid=2502b0cae86fd8131e9cd1b1ee660b55", source: "https://www.wxxv25.com/weather-cameras/", provider: "WXXV", outlook: "Bay / coast" },
  { id: "biloxi-west", name: "West Biloxi, MS", latitude: 30.39, longitude: -88.9, embed: "https://api.wetmet.net/widgets/stream/frame.php?uid=5055c4885991616ff771d9f57be64b1b", source: "https://www.wxxv25.com/weather-cameras/", provider: "WXXV", outlook: "Coastal city" },
  { id: "gulf-shores", name: "Gulf Shores, AL", latitude: 30.25, longitude: -87.7, embed: "https://api.wetmet.net/widgets/stream/frame.php?uid=5da7ce0cd284c9bc597bd3777dc4ac00", source: "https://www.brett-robinson.com/webcams/", provider: "Brett / Phoenix Gulf Towers", outlook: "Gulf-facing beach" },
  { id: "perdido", name: "Perdido Key, FL", latitude: 30.3, longitude: -87.43, embed: "https://perdidokeyog.com/embed/cam/", source: "https://perdidokeyog.com/live-cam/", provider: "Perdido Key OG", outlook: "South-facing Gulf" },
  { id: "pensacola", name: "Pensacola, FL", latitude: 30.33, longitude: -87.14, embed: "https://www.youtube.com/embed/2X0GdFzfv3A?autoplay=1&mute=1&playsinline=1", source: "https://www.visitpensacola.com/webcams/south-view-webcam/", provider: "Visit Pensacola", outlook: "South view" },
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
  // Gulf-facing AL/FL/MS camera corridor; not a landfall forecast or coastline model.
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
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      result.push({ longitude: value[0], latitude: value[1] });
    } else value.forEach(walk);
  };
  walk(alert.geometry?.coordinates);
  return result;
}

function warningCamera(alerts: NwsAlert[]): { camera: CoastCamera; event: string; distance: number } | null {
  const prioritized = alerts.filter((alert) => /^(tornado warning|severe thunderstorm warning)$/i.test(alert.properties?.event ?? ""))
    .sort((a, b) => Number(/tornado/i.test(b.properties?.event ?? "")) - Number(/tornado/i.test(a.properties?.event ?? "")));
  for (const alert of prioritized) {
    const points = alertPoints(alert);
    if (!points.length) continue;
    const closest = coastCameras.map((camera) => ({ camera, event: alert.properties.event!, distance: Math.min(...points.map((point) => miles(camera, point))) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (closest.distance <= 60) return closest;
  }
  return null;
}

export function selectCameras(data: PublicHurricane, alerts: NwsAlert[]) {
  const target = projectedCoast(data);
  if (!target) return { center: null, desktop: [], warning: null, target: null, coastalPassageLikely: false };
  const center = [...coastCameras].sort((a, b) => miles(a, target) - miles(b, target))[0];
  const west = [...coastCameras].filter((camera) => camera.longitude < center.longitude - 0.05)
    .sort((a, b) => miles(a, target) - miles(b, target))[0];
  const east = [...coastCameras].filter((camera) => camera.longitude > center.longitude + 0.05)
    .sort((a, b) => miles(a, target) - miles(b, target))[0];
  const desktop = [west, center, east].filter((camera): camera is CoastCamera => Boolean(camera));
  for (const camera of [...coastCameras].sort((a, b) => miles(a, target) - miles(b, target))) {
    if (desktop.length >= 3) break;
    if (!desktop.includes(camera)) desktop.push(camera);
  }
  const storm = data.storm.center;
  const coastalPassageLikely = data.status === "post_storm_watch" ||
    (storm.latitude != null && storm.longitude != null && storm.latitude >= 30.1 && storm.longitude >= -90.5 && storm.longitude <= -86.5);
  const warning = coastalPassageLikely ? warningCamera(alerts) : null;
  if (warning && !desktop.includes(warning.camera)) desktop[warning.camera.longitude < center.longitude ? 0 : 2] = warning.camera;
  return { center: warning?.camera ?? center, desktop, warning, target, coastalPassageLikely };
}
