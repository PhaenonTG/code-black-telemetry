import { Preferences } from "@capacitor/preferences";
import type { AtlasGpsPoint } from "../map/types";
import { getActiveMissionSession } from "./missionSession";

export interface BreadcrumbPoint {
  id: string;
  lat: number;
  lon: number;
  timestamp: number;
  at: number;
  speedMph: number | null;
  headingDeg: number | null;
  sessionId: string | null;
  accuracyM?: number | null;
  altitudeM?: number | null;
  provider?: string | null;
  source?: string | null;
  valid?: boolean;
  stale?: boolean;
  headingAvailable?: boolean;
  speedAvailable?: boolean;
}

const TRAIL_MAX_AGE_MS = 3 * 60 * 60_000; // 3 hours
const TRAIL_MAX_POINTS = 2500;
const TRAIL_PREF_KEY = "codeblack.breadcrumbTrail.v1";
const MIN_POINT_DISTANCE_M = 15; // coarser than the vehicle layer's own 4m redraw threshold —
// keeps the trail's point count sane over a multi-hour drive without losing its shape.

let trail: BreadcrumbPoint[] = [];
const listeners = new Set<(trail: BreadcrumbPoint[]) => void>();

function metersBetween(a: BreadcrumbPoint, b: { lat: number; lon: number }) {
  const metersPerDegreeLat = 111_320;
  const meanLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dLat = (b.lat - a.lat) * metersPerDegreeLat;
  const dLon = (b.lon - a.lon) * metersPerDegreeLat * Math.cos(meanLat);
  return Math.hypot(dLat, dLon);
}

function pruneExpired(now: number) {
  const cutoff = now - TRAIL_MAX_AGE_MS;
  const kept = trail.filter((point) => point.timestamp >= cutoff).slice(-TRAIL_MAX_POINTS);
  if (kept.length !== trail.length) trail = kept;
}

function notify() {
  listeners.forEach((listener) => listener(trail));
}

function persistSoon() {
  const payload = JSON.stringify(trail.slice(-TRAIL_MAX_POINTS));
  void Preferences.set({ key: TRAIL_PREF_KEY, value: payload });
}

function normalizePoint(point: BreadcrumbPoint): BreadcrumbPoint | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || !Number.isFinite(point.timestamp ?? point.at)) return null;
  const timestamp = point.timestamp ?? point.at;
  return {
    ...point,
    id: point.id || `crumb-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp,
    at: point.at ?? timestamp,
    speedMph: point.speedMph ?? null,
    headingDeg: point.headingDeg ?? null,
    sessionId: point.sessionId ?? null,
    accuracyM: point.accuracyM ?? null,
    altitudeM: point.altitudeM ?? null,
    provider: point.provider ?? null,
    source: point.source ?? "web-geolocation",
    valid: point.valid ?? true,
    stale: point.stale ?? false,
    headingAvailable: point.headingAvailable ?? point.headingDeg != null,
    speedAvailable: point.speedAvailable ?? point.speedMph != null,
  };
}

export function recordBreadcrumbPoint(lat: number, lon: number, at: number = Date.now(), speedMph: number | null = null, headingDeg: number | null = null, sessionId: string | null = getActiveMissionSession()?.id ?? null) {
  pruneExpired(at);
  const last = trail[trail.length - 1];
  if (last && metersBetween(last, { lat, lon }) < MIN_POINT_DISTANCE_M) {
    notify(); // still notify — pruning above may have changed the array even without a new point
    return;
  }
  trail = [...trail, { id: `crumb-${at}-${Math.random().toString(36).slice(2, 7)}`, lat, lon, timestamp: at, at, speedMph, headingDeg, sessionId, source: "web-geolocation", valid: true, stale: false }].slice(-TRAIL_MAX_POINTS);
  persistSoon();
  notify();
}

export function recordBreadcrumbFromGps(gps: AtlasGpsPoint | null, at: number = Date.now(), sessionId: string | null = getActiveMissionSession()?.id ?? null) {
  if (!gps) return;
  recordBreadcrumbPoint(gps.lat, gps.lon, at, gps.speedMph ?? null, gps.headingDeg ?? null, sessionId);
}

export function clearBreadcrumbTrail() {
  trail = [];
  void Preferences.remove({ key: TRAIL_PREF_KEY });
  notify();
}

export function mergeBreadcrumbPoints(points: BreadcrumbPoint[]) {
  const normalized = points.map(normalizePoint).filter((point): point is BreadcrumbPoint => Boolean(point));
  if (normalized.length === 0) return trail;
  const byId = new Map<string, BreadcrumbPoint>();
  [...trail, ...normalized]
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach((point) => {
      const fallbackId = `${point.sessionId ?? "none"}:${Math.round(point.timestamp / 1000)}:${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`;
      byId.set(point.id || fallbackId, point);
    });
  trail = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
  pruneExpired(Date.now());
  persistSoon();
  notify();
  return trail;
}

export async function loadBreadcrumbTrail() {
  const saved = await Preferences.get({ key: TRAIL_PREF_KEY });
  try {
    const parsed = saved.value ? JSON.parse(saved.value) as BreadcrumbPoint[] : [];
    trail = parsed
      .map((point) => normalizePoint(point))
      .filter((point): point is BreadcrumbPoint => Boolean(point));
  } catch {
    trail = [];
  }
  pruneExpired(Date.now());
  notify();
  return trail;
}

export function getBreadcrumbTrail() {
  return trail;
}

export function getLatestBreadcrumbPoint(sessionId: string | null = getActiveMissionSession()?.id ?? null) {
  const candidates = sessionId ? trail.filter((point) => point.sessionId === sessionId) : trail;
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

export function subscribeBreadcrumbTrail(listener: (trail: BreadcrumbPoint[]) => void) {
  listeners.add(listener);
  listener(trail);
  return () => {
    listeners.delete(listener);
  };
}
