import type { PublicHurricane } from "./types";
import type { WatchLocation } from "./watchLocation";
import { distanceMiles } from "./watchLocation";

type ObservedPoint = PublicHurricane["observed"]["track"][number];

export function latestPriorObservation(data: PublicHurricane): ObservedPoint | null {
  const advisoryTime = Date.parse(data.storm.last_update ?? "");
  if (!Number.isFinite(advisoryTime)) return null;
  return data.observed.track
    .filter((point) => point.valid_time && Number.isFinite(Date.parse(point.valid_time)) && Date.parse(point.valid_time) < advisoryTime)
    .reduce<ObservedPoint | null>((latest, point) => !latest || Date.parse(point.valid_time!) > Date.parse(latest.valid_time!) ? point : latest, null);
}

export function currentAdvisoryTrend(data: PublicHurricane, watch: WatchLocation) {
  const prior = latestPriorObservation(data);
  const center = data.storm.center;
  const elapsedHours = prior ? Math.round((Date.parse(data.storm.last_update!) - Date.parse(prior.valid_time!)) / 3_600_000) : null;
  // A very old or future best-track point is not a meaningful comparison.
  if (!prior || elapsedHours === null || elapsedHours < 1 || elapsedHours > 36) {
    return { prior: null, elapsedHours: null, wind: null, pressure: null, distance: null };
  }
  const currentDistance = center.latitude == null || center.longitude == null ? null : distanceMiles(center as { latitude: number; longitude: number }, watch);
  const priorDistance = distanceMiles(prior, watch);
  return {
    prior,
    elapsedHours,
    wind: data.storm.max_wind_mph == null || prior.wind_mph == null ? null : data.storm.max_wind_mph - prior.wind_mph,
    pressure: data.storm.pressure_mb == null || prior.pressure_mb == null ? null : data.storm.pressure_mb - prior.pressure_mb,
    distance: currentDistance == null ? null : Math.round(currentDistance - priorDistance),
  };
}

export function compassDirection(degrees: number | null): string | null {
  if (degrees == null || !Number.isFinite(degrees)) return null;
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

// Coarse open-Gulf shoreline reference for a CENTER crossing estimate. This is
// deliberately regional: bays/barrier islands and forecast uncertainty make a
// street-level landfall point inappropriate for this display.
const northernGulfCoast = [
  { longitude: -90.5, latitude: 30.03 },
  { longitude: -89.5, latitude: 30.20 },
  { longitude: -88.5, latitude: 30.24 },
  { longitude: -87.5, latitude: 30.31 },
  { longitude: -86.5, latitude: 30.36 },
  { longitude: -85.5, latitude: 30.21 },
  { longitude: -84.5, latitude: 29.85 },
];

function coastLatitude(longitude: number): number | null {
  for (let index = 1; index < northernGulfCoast.length; index++) {
    const west = northernGulfCoast[index - 1], east = northernGulfCoast[index];
    if (longitude >= west.longitude && longitude <= east.longitude) {
      const share = (longitude - west.longitude) / (east.longitude - west.longitude);
      return west.latitude + share * (east.latitude - west.latitude);
    }
  }
  return null;
}

function coastRegion(longitude: number): string {
  if (longitude < -89.5) return "Southeast Louisiana / Mississippi coast";
  if (longitude < -88.4) return "Mississippi / Alabama coast";
  if (longitude < -87.6) return "Alabama coast";
  if (longitude < -86.8) return "Western Florida Panhandle / Alabama coast";
  if (longitude < -85.6) return "Western Florida Panhandle coast";
  return "Eastern Florida Panhandle coast";
}

export type LandfallEstimate = { centerTime: string; windowStart: string; windowEnd: string; region: string; latitude: number; longitude: number; members: number | null };

export function estimateNorthernGulfLandfall(data: PublicHurricane, source: "aegis" | "nhc"): LandfallEstimate | null {
  if (data.status !== "active") return null;
  if (source === "aegis" && data.projection.status !== "ready") return null;
  const track = source === "aegis" ? data.projection.points : data.official.track;
  const issued = Date.parse(source === "aegis" ? track.find((point) => point.hour === 0)?.valid_time ?? "" : data.storm.last_update ?? "");
  if (!Number.isFinite(issued)) return null;
  const points = [...track].sort((a, b) => a.hour - b.hour);
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1], to = points[index];
    const fromCoast = coastLatitude(from.longitude), toCoast = coastLatitude(to.longitude);
    if (fromCoast == null || toCoast == null || from.latitude >= fromCoast || to.latitude < toCoast || to.hour <= from.hour) continue;
    const fromOffset = from.latitude - fromCoast, toOffset = to.latitude - toCoast;
    const share = -fromOffset / (toOffset - fromOffset);
    const hour = from.hour + share * (to.hour - from.hour);
    const longitude = from.longitude + share * (to.longitude - from.longitude);
    const latitude = from.latitude + share * (to.latitude - from.latitude);
    return {
      centerTime: new Date(issued + Math.round(hour) * 3_600_000).toISOString(),
      windowStart: new Date(issued + from.hour * 3_600_000).toISOString(),
      windowEnd: new Date(issued + to.hour * 3_600_000).toISOString(),
      region: coastRegion(longitude), latitude, longitude,
      members: source === "aegis" ? Math.min((from as typeof data.projection.points[number]).members ?? 0, (to as typeof data.projection.points[number]).members ?? 0) : null,
    };
  }
  return null;
}
