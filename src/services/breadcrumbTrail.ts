// Session-scoped "where I've been" trail for the vehicle position dot. Deliberately in-memory
// only (no Preferences persistence) — a trail from a prior chase shouldn't linger into today's,
// and syncing this to a server for team visibility is an explicit future step, not built here.
// A single module-level history is shared by every AtlasMap instance (the app can have more than
// one mounted at once — e.g. the Weather page's map card and the Locate page's map card — and
// they must all show the same continuous trail, not one each).

export interface BreadcrumbPoint {
  lat: number;
  lon: number;
  at: number;
}

const TRAIL_MAX_AGE_MS = 3 * 60 * 60_000; // 3 hours
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
  const kept = trail.filter((point) => point.at >= cutoff);
  if (kept.length !== trail.length) trail = kept;
}

function notify() {
  listeners.forEach((listener) => listener(trail));
}

export function recordBreadcrumbPoint(lat: number, lon: number, at: number = Date.now()) {
  pruneExpired(at);
  const last = trail[trail.length - 1];
  if (last && metersBetween(last, { lat, lon }) < MIN_POINT_DISTANCE_M) {
    notify(); // still notify — pruning above may have changed the array even without a new point
    return;
  }
  trail = [...trail, { lat, lon, at }];
  notify();
}

export function clearBreadcrumbTrail() {
  trail = [];
  notify();
}

export function getBreadcrumbTrail() {
  return trail;
}

export function subscribeBreadcrumbTrail(listener: (trail: BreadcrumbPoint[]) => void) {
  listeners.add(listener);
  listener(trail);
  return () => {
    listeners.delete(listener);
  };
}
