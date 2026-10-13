import { describe, expect, it } from "vitest";
import { CHASER_LOCATION_MAX_AGE_MS, isChaserUnit, liveChaserFix, liveChaserPoint, locationPoint, retainedChaserFix, retainedChaserPoint, timestampMs } from "./referenceLocation";

describe("location validation", () => {
  it("holds a selected chaser's last verified point through a temporary dropout", () => {
    const lastVerified = { lat: 38.667, lon: -96.932 };
    expect(retainedChaserPoint(null, lastVerified)).toBe(lastVerified);
    expect(retainedChaserPoint({ lat: 38.668, lon: -96.931 }, lastVerified)).toEqual({ lat: 38.668, lon: -96.931 });
    expect(retainedChaserPoint(null, null)).toBeNull();
  });

  it("retains the observation time with the last verified chaser fix", () => {
    const lastVerified = { point: { lat: 38.667, lon: -96.932 }, observedAt: 1_760_000_000_000 };
    expect(retainedChaserFix(null, lastVerified)).toBe(lastVerified);
    expect(retainedChaserFix(null, null)).toBeNull();
  });

  it("does not turn null, blank, or boolean coordinates into an apparent Gulf of Guinea position", () => {
    for (const missing of [null, undefined, "", " ", false, [], {}]) {
      expect(locationPoint({ lat: missing, lon: missing })).toBeNull();
    }
  });
  it("accepts valid aliases and explicit zero coordinates", () => {
    expect(locationPoint({ latitude: "36.45", longitude: "-94.12" })).toEqual({ lat: 36.45, lon: -94.12 });
    expect(locationPoint({ lat: 0, lng: 0 })).toEqual({ lat: 0, lon: 0 });
  });
  it("rejects positions outside the earth and nonfinite values", () => {
    expect(locationPoint({ lat: 90.1, lon: 0 })).toBeNull();
    expect(locationPoint({ lat: 0, lon: -180.1 })).toBeNull();
    expect(locationPoint({ lat: NaN, lon: Infinity })).toBeNull();
  });
});

describe("Fabric timestamps", () => {
  const iso = "2026-10-13T07:31:21.591000Z";
  const milliseconds = Date.parse(iso);
  it("normalizes ISO dates, Unix seconds, and milliseconds", () => {
    expect(timestampMs(iso)).toBe(milliseconds);
    expect(timestampMs(milliseconds / 1000)).toBe(milliseconds);
    expect(timestampMs(milliseconds)).toBe(milliseconds);
    expect(timestampMs(String(milliseconds / 1000))).toBe(milliseconds);
  });
  it("rejects unknown or invalid dates instead of coercing them", () => {
    for (const unknown of [null, undefined, "", " ", false, 0, -1, Infinity, "not a date", "2026-99-99T00:00:00Z"]) {
      expect(timestampMs(unknown)).toBeNull();
    }
  });
});

describe("live chaser references", () => {
  const now = Date.parse("2026-10-13T07:32:00Z");
  const unit = { unit_type: "chase-platform", role: "lead-chase-platform", overall_health: "LIVE", last_seen: now, location: { lat: 36.45, lon: -94.12, observed_at: new Date(now - 1000).toISOString() } };

  it("uses fresh timestamped GPS and recognizes chase roles", () => {
    expect(liveChaserPoint(unit, now)).toEqual({ lat: 36.45, lon: -94.12 });
    expect(isChaserUnit({ unit_type: "other", role: "lead-chase-platform" })).toBe(true);
    expect(isChaserUnit({ unit_type: "station", role: "core" })).toBe(false);
  });
  it("does not refresh an old fix when heartbeats or metadata update", () => {
    expect(liveChaserPoint({ ...unit, location: { ...unit.location, observed_at: now - CHASER_LOCATION_MAX_AGE_MS - 1, updated_at: now } }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: { lat: 36.45, lon: -94.12 } }, now)).toBeNull();
  });
  it("supports timestamp and updated_at only when no authoritative observation timestamp exists", () => {
    expect(liveChaserPoint({ ...unit, location: { lat: 36.45, lon: -94.12, timestamp: now / 1000 } }, now)).toEqual({ lat: 36.45, lon: -94.12 });
    expect(liveChaserPoint({ ...unit, location: { lat: 36.45, lon: -94.12, updated_at: new Date(now).toISOString() } }, now)).toEqual({ lat: 36.45, lon: -94.12 });
  });
  it("rejects offline, invalid, future, and non-chaser fixes", () => {
    expect(liveChaserPoint({ ...unit, overall_health: "OFFLINE" }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: { ...unit.location, has_fix: false } }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: { ...unit.location, observed_at: now + 60_000 } }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, unit_type: "station", role: "core" }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: { ...unit.location, observed_at: "invalid", updated_at: now } }, now)).toBeNull();
  });

  const point = { lat: 36.45, lon: -94.12 };
  const esp = {
    connected: true, health_state: "LIVE", last_seen: new Date(now).toISOString(),
    latest: { location: point, mesonet: { latitude: point.lat, longitude: point.lon } },
    metadata: { quality: {
      latitude: { state: "live", observed_at: new Date(now - 1000).toISOString() },
      longitude: { state: "live", observed_at: new Date(now - 2000).toISOString() },
    } },
  };

  it("resolves Core's undated ESP canonical location from matching coordinate quality timestamps", () => {
    expect(liveChaserFix({ ...unit, location: point, devices: [esp] }, now)).toEqual({ point, observedAt: now - 2000 });
  });
  it("requires both ESP coordinates to be live, timestamped, and to match the canonical pair", () => {
    expect(liveChaserPoint({ ...unit, location: { lat: 37, lon: -94 }, devices: [esp] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: point, devices: [{ ...esp, metadata: { quality: { ...esp.metadata.quality, latitude: { state: "unavailable", observed_at: now } } } }] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: point, devices: [{ ...esp, metadata: {} }] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: point, devices: [{ ...esp, latest: { mesonet: esp.latest.mesonet } }] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: point, devices: [{ ...esp, metadata: { quality: { ...esp.metadata.quality, latitude: { state: "live", observed_at: now - 300_000 } } } }] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: point, devices: [{ ...esp, metadata: { quality: { ...esp.metadata.quality, latitude: { state: "live", observed_at: now + 300_000 } } } }] }, now)).toBeNull();
  });
  it("does not override an explicit canonical old or invalid timestamp with fresh device data", () => {
    expect(liveChaserPoint({ ...unit, location: { ...point, observed_at: now - 300_000 }, devices: [esp] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: { ...point, observed_at: null }, devices: [esp] }, now)).toBeNull();
  });

  const android = {
    connected: true, health_state: "LIVE", last_seen: new Date(now - 1000).toISOString(),
    latest: { ...point, location_fix_age_ms: 5000 },
    transport: { protocol_version: "chase-telemetry-2.0.0" },
    metadata: { location_state: "fresh" },
  };

  it("resolves Android direct lat/lon using the server-validated GPS fix age", () => {
    expect(liveChaserFix({ ...unit, location: null, devices: [android] }, now)).toEqual({ point, observedAt: now - 6000 });
    expect(liveChaserPoint({ ...unit, location: point, devices: [android] }, now)).toEqual(point);
  });
  it("does not promote a snapshot heartbeat to a GPS fix when its location is stale or undated", () => {
    expect(liveChaserPoint({ ...unit, location: null, devices: [{ ...android, metadata: { location_state: "stale" } }] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: null, devices: [{ ...android, latest: point }] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: null, devices: [{ ...android, latest: { ...point, location_fix_age_ms: 180_000 } }] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: null, devices: [{ ...android, connected: false }] }, now)).toBeNull();
  });
  it("recognizes legacy Android fix timestamps and chooses the newest matching source", () => {
    const legacy = { ...android, last_seen: new Date(now - 500).toISOString(), transport: { protocol_version: "chase-v2-heartbeat-v1" }, metadata: {} };
    expect(liveChaserFix({ ...unit, location: point, devices: [esp, android, legacy] }, now)).toEqual({ point, observedAt: now - 500 });
    expect(liveChaserPoint({ ...unit, location: null, devices: [{ ...legacy, last_seen: now - 300_000 }] }, now)).toBeNull();
    expect(liveChaserPoint({ ...unit, location: null, devices: [{ ...legacy, transport: { protocol_version: "unknown" } }] }, now)).toBeNull();
  });
});
