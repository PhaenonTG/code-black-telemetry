export type LiveOverlayTelemetrySource = "CODEBLACK_OPS";
export type LiveOverlayTelemetryFreshness = "live" | "aging" | "stale" | "offline";
export type LiveOverlayTelemetryPublishReason = "initial" | "elapsed" | "movement" | "heading" | "session";

export interface LiveOverlayTelemetryPayload {
  stationId: string;
  sessionId: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  speedMps?: number;
  headingDeg?: number;
  altitudeM?: number;
  source: LiveOverlayTelemetrySource;
}

export interface LiveOverlayTelemetrySnapshot {
  stationId: string;
  stationName: string;
  sessionId: string;
  telemetry: LiveOverlayTelemetryPayload;
  receivedAt: number;
  ageMs: number;
  freshness: LiveOverlayTelemetryFreshness;
}

export interface LiveOverlayTelemetryStationCredential {
  stationId: string;
  stationName?: string;
  token: string;
}

export interface LiveOverlayTelemetryValidationResult {
  ok: boolean;
  payload?: LiveOverlayTelemetryPayload;
  errorCode?: string;
  errorSummary?: string;
}

export interface LiveOverlayTelemetryIngestResult {
  accepted: boolean;
  snapshot: LiveOverlayTelemetrySnapshot | null;
  errorCode?: string;
  errorSummary?: string;
}

export interface LiveOverlayTelemetryReadResult {
  found: boolean;
  snapshot: LiveOverlayTelemetrySnapshot | null;
}

export interface LiveOverlayTelemetryFreshnessPolicy {
  liveMs: number;
  agingMs: number;
  staleMs: number;
  maxAcceptedAgeMs: number;
  maxFutureSkewMs: number;
}

export interface LiveOverlayTelemetryPublishPolicy {
  minIntervalMs: number;
  maxIntervalMs: number;
  minMovementM: number;
  minHeadingDeltaDeg: number;
  maxPacketAgeMs: number;
}

export const LIVE_OVERLAY_TELEMETRY_INGEST_PATH = "/api/telemetry/live/location";
export const LIVE_OVERLAY_TELEMETRY_READ_PATH_PREFIX = "/api/telemetry/live";
export const LIVE_OVERLAY_TELEMETRY_SOURCE: LiveOverlayTelemetrySource = "CODEBLACK_OPS";

export const DEFAULT_LIVE_OVERLAY_FRESHNESS_POLICY: LiveOverlayTelemetryFreshnessPolicy = {
  liveMs: 10_000,
  agingMs: 30_000,
  staleMs: 90_000,
  maxAcceptedAgeMs: 60_000,
  maxFutureSkewMs: 30_000,
};

export const DEFAULT_LIVE_OVERLAY_PUBLISH_POLICY: LiveOverlayTelemetryPublishPolicy = {
  minIntervalMs: 2_500,
  maxIntervalMs: 5_000,
  minMovementM: 10,
  minHeadingDeltaDeg: 15,
  maxPacketAgeMs: 30_000,
};

const STATION_ID_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const parsed = finiteNumber(value);
  return parsed == null ? Number.NaN : parsed;
}

function sanitizeStationId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function reject(errorCode: string, errorSummary: string): LiveOverlayTelemetryValidationResult {
  return { ok: false, errorCode, errorSummary };
}

export function validateLiveOverlayTelemetryPayload(
  input: unknown,
  now = Date.now(),
  policy: LiveOverlayTelemetryFreshnessPolicy = DEFAULT_LIVE_OVERLAY_FRESHNESS_POLICY,
): LiveOverlayTelemetryValidationResult {
  if (!input || typeof input !== "object") return reject("MALFORMED_PAYLOAD", "Telemetry payload must be an object.");
  const record = input as Record<string, unknown>;
  let size = 0;
  try {
    size = JSON.stringify(input).length;
  } catch {
    return reject("MALFORMED_PAYLOAD", "Telemetry payload is not serializable.");
  }
  if (size > 2048) return reject("PAYLOAD_TOO_LARGE", "Telemetry payload is too large.");

  const stationId = sanitizeStationId(record.stationId);
  if (!STATION_ID_RE.test(stationId)) return reject("INVALID_STATION", "Station ID is missing or invalid.");
  const sessionId = String(record.sessionId ?? "").trim();
  if (!sessionId || sessionId.length > 96) return reject("INVALID_SESSION", "Session ID is missing or invalid.");
  const timestamp = finiteNumber(record.timestamp);
  if (timestamp == null) return reject("INVALID_TIMESTAMP", "Telemetry timestamp is invalid.");
  if (timestamp < now - policy.maxAcceptedAgeMs) return reject("STALE_PACKET", "Telemetry packet is too old for live overlay ingest.");
  if (timestamp > now + policy.maxFutureSkewMs) return reject("FUTURE_PACKET", "Telemetry packet timestamp is too far in the future.");

  const latitude = finiteNumber(record.latitude);
  const longitude = finiteNumber(record.longitude);
  if (latitude == null || latitude < -90 || latitude > 90) return reject("INVALID_COORDINATE", "Latitude is invalid.");
  if (longitude == null || longitude < -180 || longitude > 180) return reject("INVALID_COORDINATE", "Longitude is invalid.");

  const accuracyM = optionalFiniteNumber(record.accuracyM);
  const speedMps = optionalFiniteNumber(record.speedMps);
  const headingDeg = optionalFiniteNumber(record.headingDeg);
  const altitudeM = optionalFiniteNumber(record.altitudeM);
  if (Number.isNaN(accuracyM) || (accuracyM != null && (accuracyM < 0 || accuracyM > 100_000))) return reject("INVALID_ACCURACY", "Accuracy is invalid.");
  if (Number.isNaN(speedMps) || (speedMps != null && (speedMps < 0 || speedMps > 150))) return reject("INVALID_SPEED", "Speed is invalid.");
  if (Number.isNaN(headingDeg) || (headingDeg != null && (headingDeg < 0 || headingDeg >= 360))) return reject("INVALID_HEADING", "Heading is invalid.");
  if (Number.isNaN(altitudeM) || (altitudeM != null && (altitudeM < -1000 || altitudeM > 25_000))) return reject("INVALID_ALTITUDE", "Altitude is invalid.");
  if (record.source !== LIVE_OVERLAY_TELEMETRY_SOURCE) return reject("INVALID_SOURCE", "Telemetry source is invalid.");

  return {
    ok: true,
    payload: {
      stationId,
      sessionId,
      timestamp,
      latitude,
      longitude,
      ...(accuracyM == null ? {} : { accuracyM }),
      ...(speedMps == null ? {} : { speedMps }),
      ...(headingDeg == null ? {} : { headingDeg }),
      ...(altitudeM == null ? {} : { altitudeM }),
      source: LIVE_OVERLAY_TELEMETRY_SOURCE,
    },
  };
}

export function liveOverlayTelemetryFreshness(
  telemetryAt: number | null,
  now = Date.now(),
  policy: LiveOverlayTelemetryFreshnessPolicy = DEFAULT_LIVE_OVERLAY_FRESHNESS_POLICY,
): LiveOverlayTelemetryFreshness {
  if (!telemetryAt) return "offline";
  const age = Math.max(0, now - telemetryAt);
  if (age <= policy.liveMs) return "live";
  if (age <= policy.agingMs) return "aging";
  if (age <= policy.staleMs) return "stale";
  return "offline";
}

export function bearingDeltaDeg(a: number | undefined, b: number | undefined) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

export function distanceMeters(a: Pick<LiveOverlayTelemetryPayload, "latitude" | "longitude">, b: Pick<LiveOverlayTelemetryPayload, "latitude" | "longitude">) {
  const toRad = (value: number) => value * Math.PI / 180;
  const earthRadiusM = 6_371_000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function shouldPublishLiveOverlayTelemetry(
  previous: LiveOverlayTelemetryPayload | null,
  next: LiveOverlayTelemetryPayload,
  lastPublishedAt: number | null,
  now = Date.now(),
  policy: LiveOverlayTelemetryPublishPolicy = DEFAULT_LIVE_OVERLAY_PUBLISH_POLICY,
): { publish: boolean; reason?: LiveOverlayTelemetryPublishReason } {
  if (next.timestamp < now - policy.maxPacketAgeMs) return { publish: false };
  if (!previous || !lastPublishedAt) return { publish: true, reason: "initial" };
  if (previous.sessionId !== next.sessionId) return { publish: true, reason: "session" };
  const elapsed = now - lastPublishedAt;
  if (elapsed < policy.minIntervalMs) return { publish: false };
  if (elapsed >= policy.maxIntervalMs) return { publish: true, reason: "elapsed" };
  if (distanceMeters(previous, next) >= policy.minMovementM) return { publish: true, reason: "movement" };
  if (bearingDeltaDeg(previous.headingDeg, next.headingDeg) >= policy.minHeadingDeltaDeg) return { publish: true, reason: "heading" };
  return { publish: false };
}

export function createLiveOverlayReadUrl(baseEndpoint: string, stationId: string) {
  const base = baseEndpoint.replace(/\/+$/, "");
  return `${base}${LIVE_OVERLAY_TELEMETRY_READ_PATH_PREFIX}/${encodeURIComponent(sanitizeStationId(stationId))}`;
}

export function createLiveOverlayIngestUrl(baseEndpoint: string) {
  return `${baseEndpoint.replace(/\/+$/, "")}${LIVE_OVERLAY_TELEMETRY_INGEST_PATH}`;
}

export class LiveOverlayTelemetryLatestStore {
  private readonly stations = new Map<string, LiveOverlayTelemetryStationCredential>();
  private readonly latest = new Map<string, LiveOverlayTelemetryPayload>();

  constructor(stations: LiveOverlayTelemetryStationCredential[] = []) {
    stations.forEach((station) => {
      const stationId = sanitizeStationId(station.stationId);
      if (stationId && station.token) this.stations.set(stationId, { ...station, stationId });
    });
  }

  ingest(
    authorizationHeader: string | null | undefined,
    input: unknown,
    now = Date.now(),
    policy: LiveOverlayTelemetryFreshnessPolicy = DEFAULT_LIVE_OVERLAY_FRESHNESS_POLICY,
  ): LiveOverlayTelemetryIngestResult {
    const validated = validateLiveOverlayTelemetryPayload(input, now, policy);
    if (!validated.ok || !validated.payload) {
      return { accepted: false, snapshot: null, errorCode: validated.errorCode, errorSummary: validated.errorSummary };
    }
    const station = this.stations.get(validated.payload.stationId);
    if (!station) return { accepted: false, snapshot: null, errorCode: "UNKNOWN_STATION", errorSummary: "Station is not authorized." };
    const token = readBearerToken(authorizationHeader);
    if (!token) return { accepted: false, snapshot: null, errorCode: "AUTH_REQUIRED", errorSummary: "Bearer token is required." };
    if (token !== station.token) return { accepted: false, snapshot: null, errorCode: "AUTH_FAILED", errorSummary: "Station token was rejected." };

    const current = this.latest.get(validated.payload.stationId);
    if (current && current.timestamp > validated.payload.timestamp) {
      return { accepted: false, snapshot: this.snapshotFor(station, current, now, policy), errorCode: "OLDER_PACKET", errorSummary: "Older telemetry cannot replace the latest station state." };
    }

    this.latest.set(validated.payload.stationId, validated.payload);
    return { accepted: true, snapshot: this.snapshotFor(station, validated.payload, now, policy) };
  }

  read(stationId: string, now = Date.now(), policy: LiveOverlayTelemetryFreshnessPolicy = DEFAULT_LIVE_OVERLAY_FRESHNESS_POLICY): LiveOverlayTelemetryReadResult {
    const normalized = sanitizeStationId(stationId);
    const telemetry = this.latest.get(normalized);
    const station = this.stations.get(normalized);
    if (!telemetry || !station) return { found: false, snapshot: null };
    return { found: true, snapshot: this.snapshotFor(station, telemetry, now, policy) };
  }

  private snapshotFor(
    station: LiveOverlayTelemetryStationCredential,
    telemetry: LiveOverlayTelemetryPayload,
    now: number,
    policy: LiveOverlayTelemetryFreshnessPolicy,
  ): LiveOverlayTelemetrySnapshot {
    return {
      stationId: telemetry.stationId,
      stationName: station.stationName ?? telemetry.stationId,
      sessionId: telemetry.sessionId,
      telemetry,
      receivedAt: now,
      ageMs: Math.max(0, now - telemetry.timestamp),
      freshness: liveOverlayTelemetryFreshness(telemetry.timestamp, now, policy),
    };
  }
}

function readBearerToken(value: string | null | undefined) {
  const match = String(value ?? "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}
