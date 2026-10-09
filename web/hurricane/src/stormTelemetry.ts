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
