import type { GpsData, GpsSource } from "./telemetry/types";
import type { LocalityResult } from "./situational";
import { ageSeconds, cardinalFromDeg, distanceMiles, isFiniteNumber } from "./telemetry/quality";

export type CanonicalLocationSource = "tablet-gps" | "vehicle-gps" | "esp-gps" | "cached-gps" | "simulated-debug" | "unavailable";
export type CanonicalFreshness = "LIVE" | "RECENT" | "DELAYED" | "STALE" | "OFFLINE" | "INVALID";
export type CanonicalValidity = "VALID" | "INVALID" | "UNAVAILABLE";
export type CanonicalFixState = "FIX_3D" | "FIX_2D" | "LAST_KNOWN" | "ACQUIRING" | "INVALID";

export interface CanonicalLocation {
  latitude: number | null;
  longitude: number | null;
  altitudeFt: number | null;
  speedMph: number | null;
  headingDeg: number | null;
  headingCardinal: string;
  accuracyM: number | null;
  altitudeAccuracyM: number | null;
  timestamp: number | null;
  source: CanonicalLocationSource;
  freshness: CanonicalFreshness;
  validity: CanonicalValidity;
  fixState: CanonicalFixState;
  satelliteCount: number | null;
  resolvedCity: string | null;
  resolvedState: string | null;
  resolvedCounty: string | null;
  reverseGeocodeTimestamp: number | null;
  reverseGeocodeSource: LocalityResult["source"] | "none";
  fallbackReason: string;
  rawSource: GpsSource | "none";
  requestKey: string | null;
}

export function isValidLatitude(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -180 && value <= 180;
}

export function isValidLocation(lat: unknown, lon: unknown) {
  return isValidLatitude(lat) && isValidLongitude(lon) && !(lat === 0 && lon === 0);
}

export function toLngLat(location: Pick<CanonicalLocation, "latitude" | "longitude">): [number, number] | null {
  return isValidLocation(location.latitude, location.longitude) ? [location.longitude!, location.latitude!] : null;
}

export function locationRequestKey(pos: { lat: number; lon: number }) {
  return `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
}

function sourceFromGps(source: GpsSource): CanonicalLocationSource {
  if (source === "tablet") return "tablet-gps";
  if (source === "vehicle") return "vehicle-gps";
  if (source === "esp") return "esp-gps";
  if (source === "last-known") return "cached-gps";
  if (source === "simulator") return "simulated-debug";
  return "unavailable";
}

function freshnessFromAge(age: number | null, valid: boolean): CanonicalFreshness {
  if (!valid) return "INVALID";
  if (age === null) return "OFFLINE";
  if (age <= 10) return "LIVE";
  if (age <= 90) return "RECENT";
  if (age <= 300) return "DELAYED";
  if (age <= 1800) return "STALE";
  return "OFFLINE";
}

function parseDisplayName(displayName: string, fallbackState: string) {
  const cleaned = displayName.replace(/^NEAR\s+/i, "").trim();
  const parts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  return {
    city: parts[0] || null,
    state: parts[1] || fallbackState || null,
  };
}

// Stationary GPS speed jitters in the 0.1-0.8 mph range from position drift alone, even parked
// with a clean fix — confirmed on-device sitting still. Floor anything under this to a clean 0
// rather than showing false motion.
const GPS_SPEED_NOISE_FLOOR_MPH = 1.5;

export function buildCanonicalLocation(gps: GpsData | null | undefined, locality: LocalityResult | null): CanonicalLocation {
  const valid = Boolean(gps?.hasFix && isValidLocation(gps.lat, gps.lon) && gps.source !== "simulator" && gps.source !== "unavailable");
  const staleSimulator = gps?.source === "simulator";
  const age = gps?.updatedAt ? ageSeconds(gps.updatedAt) : null;
  const acceptedLocality = valid && locality && distanceMiles({ lat: gps!.lat, lon: gps!.lon }, locality) <= 12 ? locality : null;
  const parsed = acceptedLocality ? parseDisplayName(acceptedLocality.displayName, acceptedLocality.state) : null;
  const source = gps ? sourceFromGps(gps.source) : "unavailable";
  const hasAltitude = gps?.elevationFt != null;
  const rawSpeed = valid ? gps!.speedMph : null;
  const speedMph = rawSpeed != null && rawSpeed < GPS_SPEED_NOISE_FLOOR_MPH ? 0 : rawSpeed;
  return {
    latitude: valid ? gps!.lat : null,
    longitude: valid ? gps!.lon : null,
    altitudeFt: valid ? gps!.elevationFt : null,
    speedMph,
    headingDeg: valid ? gps!.headingDeg : null,
    headingCardinal: valid ? gps!.headingCardinal || cardinalFromDeg(gps!.headingDeg) : "--",
    accuracyM: valid ? gps!.accuracyM : null,
    altitudeAccuracyM: null,
    timestamp: valid ? gps!.updatedAt : null,
    source: valid ? source : "unavailable",
    freshness: freshnessFromAge(age, valid),
    validity: valid ? "VALID" : gps ? "INVALID" : "UNAVAILABLE",
    fixState: valid ? (gps!.source === "last-known" ? "LAST_KNOWN" : hasAltitude ? "FIX_3D" : "FIX_2D") : staleSimulator ? "INVALID" : "ACQUIRING",
    satelliteCount: valid ? gps!.satellites : null,
    resolvedCity: parsed?.city ?? null,
    resolvedState: parsed?.state ?? null,
    resolvedCounty: acceptedLocality?.county ?? null,
    reverseGeocodeTimestamp: acceptedLocality?.updatedAt ?? null,
    reverseGeocodeSource: acceptedLocality?.source ?? "none",
    fallbackReason: valid ? acceptedLocality ? "" : "LOCALITY RESOLUTION PENDING" : staleSimulator ? "SIMULATOR GPS BLOCKED IN PRODUCTION" : "WAITING FOR VALID GPS FIX",
    rawSource: gps?.source ?? "none",
    requestKey: valid ? locationRequestKey({ lat: gps!.lat, lon: gps!.lon }) : null,
  };
}

export function sourceLabel(source: CanonicalLocationSource, internalGpsLabel = "INTERNAL GPS") {
  if (source === "tablet-gps") return internalGpsLabel.toUpperCase();
  if (source === "vehicle-gps") return "VEHICLE GPS";
  if (source === "esp-gps") return "ESP GPS";
  if (source === "cached-gps") return "LAST KNOWN";
  if (source === "simulated-debug") return "SIMULATOR";
  return "GPS ACQUIRING";
}
