export type OpsReferencePoint = { lat: number; lon: number };
export type LiveChaserFix = { point: OpsReferencePoint; observedAt: number };
export type LocationMode = "follow" | "manual" | "chaser" | "fallback";

export const PEA_RIDGE_REFERENCE: OpsReferencePoint = { lat: 36.45, lon: -94.12 };
export const CHASER_LOCATION_MAX_AGE_MS = 120_000;

/** Keep the selected operator's complete last verified fix through a temporary feed dropout. */
export function retainedChaserFix(live: LiveChaserFix | null, lastVerified: LiveChaserFix | null): LiveChaserFix | null {
  return live ?? lastVerified;
}

/** Keep the selected operator's last verified position through a temporary feed dropout. */
export function retainedChaserPoint(live: OpsReferencePoint | null, lastVerified: OpsReferencePoint | null): OpsReferencePoint | null {
  return live ?? lastVerified;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function coordinate(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Validate the position before coercion; missing coordinates must not become 0. */
export function locationPoint(raw: unknown): OpsReferencePoint | null {
  const location = record(raw);
  if (!location) return null;
  const lat = coordinate(location.lat ?? location.latitude);
  const lon = coordinate(location.lon ?? location.lng ?? location.longitude);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Fabric transports use both Unix timestamps and ISO dates. Return milliseconds. */
export function timestampMs(raw: unknown): number | null {
  if (typeof raw === "number" || (typeof raw === "string" && /^\d+(?:\.\d+)?$/.test(raw.trim()))) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const milliseconds = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
    return Number.isFinite(new Date(milliseconds).getTime()) ? milliseconds : null;
  }
  // Restrict date parsing to ISO-like dates; Date.parse("1") is a valid but unrelated date.
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(raw.trim())) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isChaserUnit(raw: unknown): boolean {
  const unit = record(raw);
  if (!unit) return false;
  return unit.unit_type === "chase-platform"
    || (typeof unit.role === "string" && /(^|[-_\s])chase(?:r)?($|[-_\s])/i.test(unit.role));
}

function observationTimestamp(location: Record<string, unknown>): { present: boolean; value: number | null } {
  for (const key of ["observed_at", "timestamp", "updated_at"]) {
    if (Object.hasOwn(location, key)) return { present: true, value: timestampMs(location[key]) };
  }
  return { present: false, value: null };
}

function freshFix(point: OpsReferencePoint, observedAt: number | null, now: number): LiveChaserFix | null {
  if (observedAt === null || !Number.isFinite(now)) return null;
  const age = now - observedAt;
  return age >= -10_000 && age <= CHASER_LOCATION_MAX_AGE_MS ? { point, observedAt } : null;
}

function samePoint(left: OpsReferencePoint, right: OpsReferencePoint): boolean {
  return Math.abs(left.lat - right.lat) < 0.000001 && Math.abs(left.lon - right.lon) < 0.000001;
}

/** Resolve a fix timestamp from the authoritative source, never the unit heartbeat. */
export function liveChaserFix(raw: unknown, now = Date.now()): LiveChaserFix | null {
  const unit = record(raw);
  if (!unit || !isChaserUnit(unit) || unit.overall_health === "OFFLINE" || unit.overall_health === "NOT_CONFIGURED") return null;
  const location = record(unit.location);
  const point = locationPoint(location);
  if (unit.location != null && (!location || !point || location.valid === false || location.has_fix === false)) return null;
  if (location && point) {
    const observed = observationTimestamp(location);
    // An explicitly dated canonical fix stays authoritative, including stale/invalid dates.
    if (observed.present) return freshFix(point, observed.value, now);
  }

  const candidates: LiveChaserFix[] = [];
  for (const rawDevice of Array.isArray(unit.devices) ? unit.devices : []) {
    const device = record(rawDevice);
    if (!device || device.connected === false || device.health_state === "OFFLINE" || device.health_state === "NOT_CONFIGURED") continue;
    const latest = record(device.latest);
    const metadata = record(device.metadata);
    if (!latest || !metadata) continue;
    const devicePoint = locationPoint(latest.location) ?? locationPoint(latest);
    // Fabric's canonical position has no source ID: only use a matching source fix.
    if (!devicePoint || (point && !samePoint(point, devicePoint))) continue;

    let observedAt: number | null = null;
    const quality = record(metadata.quality);
    const latitudeQuality = record(quality?.latitude);
    const longitudeQuality = record(quality?.longitude);
    if (locationPoint(latest.location) && latitudeQuality?.state === "live" && longitudeQuality?.state === "live") {
      // Mesonet writes location only after both coordinate quality checks pass.
      const latitudeAt = timestampMs(latitudeQuality.observed_at);
      const longitudeAt = timestampMs(longitudeQuality.observed_at);
      if (latitudeAt !== null && longitudeAt !== null && freshFix(devicePoint, latitudeAt, now) && freshFix(devicePoint, longitudeAt, now)) observedAt = Math.min(latitudeAt, longitudeAt);
    } else {
      const transport = record(device.transport);
      const protocol = transport?.protocol_version;
      if (protocol === "chase-v2-heartbeat-v1") {
        // Legacy Android location events use the GPS fix timestamp as last_seen.
        observedAt = timestampMs(device.last_seen);
      } else if (typeof protocol === "string" && /^chase-telemetry-(?:2(?:\.|$)|0\.5(?:\.|$))/.test(protocol) && metadata.location_state === "fresh") {
        // Snapshot heartbeats use event_time as last_seen; subtract server-computed fix age.
        const eventAt = timestampMs(device.last_seen);
        const fixAge = coordinate(latest.location_fix_age_ms);
        if (eventAt !== null && fixAge !== null && fixAge >= 0) observedAt = eventAt - fixAge;
      }
    }
    const candidate = freshFix(devicePoint, observedAt, now);
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort((left, right) => right.observedAt - left.observedAt)[0] ?? null;
}

/** A recent heartbeat cannot make an older (or undated) GPS fix live. */
export function liveChaserPoint(raw: unknown, now = Date.now()): OpsReferencePoint | null {
  return liveChaserFix(raw, now)?.point ?? null;
}
