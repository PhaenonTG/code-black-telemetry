export type LocationQualityState = "good" | "degraded" | "stale" | "invalid";
export type TrackingDetailPreset = "battery-saver" | "balanced" | "high-detail";

export interface LocationObservation {
  id: string;
  sessionId: string | null;
  timestampUtc: number;
  receivedAt: number;
  storedAt: number;
  latitude: number;
  longitude: number;
  horizontalAccuracyM: number | null;
  altitudeM: number | null;
  altitudeAccuracyM: number | null;
  speedMps: number | null;
  speedAccuracyMps: number | null;
  speedMph: number | null;
  headingDeg: number | null;
  headingAccuracyDeg: number | null;
  provider: string | null;
  source: string;
  quality: LocationQualityState;
  stale: boolean;
}

export function classifyLocationQuality(input: {
  latitude?: number | null;
  longitude?: number | null;
  horizontalAccuracyM?: number | null;
  timestampUtc?: number | null;
  now?: number;
}): LocationQualityState {
  const now = input.now ?? Date.now();
  const timestamp = input.timestampUtc ?? 0;
  const accuracy = input.horizontalAccuracyM ?? null;
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) || !Number.isFinite(timestamp) || timestamp <= 0) return "invalid";
  if (now - timestamp > 5 * 60_000) return "stale";
  if (accuracy == null) return "degraded";
  if (accuracy <= 75) return "good";
  if (accuracy <= 750) return "degraded";
  return "invalid";
}

export function createLocationObservation(input: Partial<LocationObservation> & {
  latitude: number;
  longitude: number;
  timestampUtc: number;
}): LocationObservation | null {
  const quality = input.quality ?? classifyLocationQuality({
    latitude: input.latitude,
    longitude: input.longitude,
    horizontalAccuracyM: input.horizontalAccuracyM ?? null,
    timestampUtc: input.timestampUtc,
  });
  if (quality === "invalid") return null;
  const receivedAt = input.receivedAt ?? Date.now();
  const storedAt = input.storedAt ?? receivedAt;
  const id = input.id || `obs-${input.sessionId ?? "none"}-${input.timestampUtc}-${Math.round(input.latitude * 100000)}-${Math.round(input.longitude * 100000)}`;
  return {
    id,
    sessionId: input.sessionId ?? null,
    timestampUtc: input.timestampUtc,
    receivedAt,
    storedAt,
    latitude: input.latitude,
    longitude: input.longitude,
    horizontalAccuracyM: input.horizontalAccuracyM ?? null,
    altitudeM: input.altitudeM ?? null,
    altitudeAccuracyM: input.altitudeAccuracyM ?? null,
    speedMps: input.speedMps ?? null,
    speedAccuracyMps: input.speedAccuracyMps ?? null,
    speedMph: input.speedMph ?? (input.speedMps != null ? input.speedMps * 2.2369362921 : null),
    headingDeg: input.headingDeg ?? null,
    headingAccuracyDeg: input.headingAccuracyDeg ?? null,
    provider: input.provider ?? null,
    source: input.source ?? "unknown",
    quality,
    stale: input.stale ?? quality === "stale",
  };
}

export function shouldKeepLocationObservation(previous: LocationObservation | null, next: LocationObservation, policy: { minDistanceM: number; minElapsedMs: number }) {
  if (!previous) return true;
  if (next.sessionId !== previous.sessionId) return true;
  if (next.timestampUtc - previous.timestampUtc >= policy.minElapsedMs) return true;
  if (metersBetweenObservations(previous, next) >= policy.minDistanceM) return true;
  const previousAccuracy = previous.horizontalAccuracyM ?? Number.POSITIVE_INFINITY;
  const nextAccuracy = next.horizontalAccuracyM ?? Number.POSITIVE_INFINITY;
  return nextAccuracy + 5 < previousAccuracy;
}

export function metersBetweenObservations(a: Pick<LocationObservation, "latitude" | "longitude">, b: Pick<LocationObservation, "latitude" | "longitude">) {
  const metersPerDegreeLat = 111_320;
  const meanLat = ((a.latitude + b.latitude) / 2) * Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * metersPerDegreeLat;
  const dLon = (b.longitude - a.longitude) * metersPerDegreeLat * Math.cos(meanLat);
  return Math.hypot(dLat, dLon);
}

export function trackingPresetPolicy(preset: TrackingDetailPreset) {
  if (preset === "high-detail") return { minDistanceM: 8, minElapsedMs: 20_000 };
  if (preset === "battery-saver") return { minDistanceM: 40, minElapsedMs: 120_000 };
  return { minDistanceM: 15, minElapsedMs: 60_000 };
}
