/**
 * Converts Core's real wire JSON (snake_case Pydantic `model_dump()` output -- see
 * `docs/design/overlay-data-flow-audit.md` for why this layer is required and was missing) into
 * the overlay's existing camelCase contract in `types.ts`. This is the one seam every transport
 * (REST bootstrap, WebSocket push, recorded fixture replay of raw wire captures) must go through.
 * Unknown/new wire fields are silently ignored (forward-compatible); missing/malformed required
 * fields throw `StormIntelNormalizationError` so callers can surface an explicit unavailable
 * state instead of rendering garbage.
 */
import { classifyDataClass } from "./dataClass";
import type {
  ContextLocation,
  MetricSource,
  MetricTrend,
  NormalizedMetric,
  StormIntelContext,
  StormIntelScore,
  StormIntelSnapshot,
} from "./types";

export class StormIntelNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StormIntelNormalizationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new StormIntelNormalizationError(`expected object at ${path}, got ${typeof value}`);
  }
  return value;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMetricSource(raw: unknown): MetricSource | null {
  if (raw === null || raw === undefined) return null;
  const r = requireRecord(raw, "metrics[].source");
  const provider = str(r.provider);
  const product = str(r.product);
  if (provider === null || product === null) {
    throw new StormIntelNormalizationError("metrics[].source requires string provider/product");
  }
  return {
    provider,
    product,
    runTime: str(r.run_time),
    validTime: str(r.valid_time),
    formulation: str(r.formulation),
  };
}

function normalizeMetricTrend(raw: unknown): MetricTrend | null {
  if (raw === null || raw === undefined) return null;
  const r = requireRecord(raw, "metrics[].trend");
  const direction = str(r.direction);
  return {
    direction:
      direction === "rising" || direction === "falling" || direction === "steady" ? direction : "unknown",
    delta: num(r.delta),
    periodMinutes: num(r.period_minutes),
  };
}

function normalizeMetric(raw: unknown): NormalizedMetric {
  const r = requireRecord(raw, "metrics[]");
  const key = str(r.key);
  const label = str(r.label);
  if (key === null || label === null) {
    throw new StormIntelNormalizationError("metrics[] requires string key/label");
  }
  const source = normalizeMetricSource(r.source ?? null);
  const availability = r.availability === "unavailable" ? "unavailable" : "available";
  const freshnessRaw = str(r.freshness);
  const freshness =
    freshnessRaw === "current" ||
    freshnessRaw === "aging" ||
    freshnessRaw === "stale" ||
    freshnessRaw === "unavailable"
      ? freshnessRaw
      : "unknown";
  const qualityRaw = str(r.quality);
  return {
    key: key as NormalizedMetric["key"],
    label,
    value: num(r.value),
    unit: str(r.unit),
    source,
    retrievedAt: str(r.retrieved_at),
    ageSeconds: num(r.age_seconds),
    freshness,
    quality:
      qualityRaw === "nominal" || qualityRaw === "degraded" || qualityRaw === "low_confidence"
        ? qualityRaw
        : null,
    availability,
    unavailableReason: str(r.unavailable_reason),
    trend: normalizeMetricTrend(r.trend ?? null),
    derivation: str(r.derivation),
    dataClass: classifyDataClass(source),
  };
}

function normalizeLocation(raw: unknown): ContextLocation {
  const r = requireRecord(raw, "context.location");
  return {
    available: bool(r.available, false),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    resolvedFrom:
      r.resolved_from === "unit_position" || r.resolved_from === "projected_position" || r.resolved_from === "explicit_target"
        ? r.resolved_from
        : null,
    unitId: str(r.unit_id),
    unitPositionObservedAt: str(r.unit_position_observed_at),
    unitPositionHealthState: str(r.unit_position_health_state),
    headingDeg: num(r.heading_deg),
    distanceMiles: num(r.distance_miles),
    unavailableReason: str(r.unavailable_reason),
  };
}

function normalizeContext(raw: unknown): StormIntelContext {
  const r = requireRecord(raw, "context");
  const contextType = str(r.context_type);
  const requestedAt = str(r.requested_at);
  if (
    (contextType !== "AT_UNIT" && contextType !== "AHEAD_OF_UNIT" && contextType !== "SELECTED_TARGET") ||
    requestedAt === null
  ) {
    throw new StormIntelNormalizationError("context requires valid context_type/requested_at");
  }
  return {
    contextType,
    location: normalizeLocation(r.location),
    requestedAt,
  };
}

function normalizeScore(raw: unknown): StormIntelScore {
  const r = requireRecord(raw, "score");
  const label = str(r.label);
  const algorithmId = str(r.algorithm_id);
  const algorithmVersion = str(r.algorithm_version);
  if (label === null || algorithmId === null || algorithmVersion === null) {
    throw new StormIntelNormalizationError("score requires string label/algorithm_id/algorithm_version");
  }
  const inputsUsed = Array.isArray(r.inputs_used) ? r.inputs_used.filter((v): v is string => typeof v === "string") : [];
  return {
    available: bool(r.available, false),
    value: num(r.value),
    label,
    algorithmId,
    algorithmVersion,
    inputsUsed: inputsUsed as StormIntelScore["inputsUsed"],
    unavailableReason: str(r.unavailable_reason),
  };
}

/** Normalizes one raw Core `StormIntelSnapshot` (REST body or WS event `payload`) into the
 * overlay's camelCase contract. Throws `StormIntelNormalizationError` on malformed input. */
export function normalizeStormIntelSnapshot(raw: unknown): StormIntelSnapshot {
  const r = requireRecord(raw, "$");
  const schema = r.schema;
  if (schema !== "codeblack.storm-intel.snapshot") {
    throw new StormIntelNormalizationError(`unexpected schema: ${String(schema)}`);
  }
  const providerName = str(r.provider_name);
  const generatedAt = str(r.generated_at);
  if (providerName === null || generatedAt === null) {
    throw new StormIntelNormalizationError("snapshot requires string provider_name/generated_at");
  }
  if (!Array.isArray(r.metrics)) {
    throw new StormIntelNormalizationError("snapshot.metrics must be an array");
  }

  const canonicalUnits: Record<string, string> = {};
  if (isRecord(r.canonical_units)) {
    for (const [k, v] of Object.entries(r.canonical_units)) {
      if (typeof v === "string") canonicalUnits[k] = v;
    }
  }

  return {
    schema: "codeblack.storm-intel.snapshot",
    schemaVersion: "1.0.0",
    generatedAt,
    context: normalizeContext(r.context),
    providerName,
    simulation: bool(r.simulation, false),
    metrics: r.metrics.map(normalizeMetric),
    score: normalizeScore(r.score),
    canonicalUnits,
    available: bool(r.available, false),
    unavailableReason: str(r.unavailable_reason),
  };
}

export interface NormalizedStormIntelEvent {
  contextType: StormIntelContext["contextType"];
  contextKey: string;
  timestamp: string;
  snapshot: StormIntelSnapshot;
}

/** Normalizes one raw `StormIntelEvent` WebSocket message (`event_type: "storm_intel.updated"`). */
export function normalizeStormIntelEvent(raw: unknown): NormalizedStormIntelEvent {
  const r = requireRecord(raw, "$");
  if (r.event_type !== "storm_intel.updated") {
    throw new StormIntelNormalizationError(`unexpected event_type: ${String(r.event_type)}`);
  }
  const contextKey = str(r.context_key);
  const timestamp = str(r.timestamp);
  const contextType = str(r.context_type);
  if (
    contextKey === null ||
    timestamp === null ||
    (contextType !== "AT_UNIT" && contextType !== "AHEAD_OF_UNIT" && contextType !== "SELECTED_TARGET")
  ) {
    throw new StormIntelNormalizationError("event requires string context_key/timestamp and valid context_type");
  }
  return {
    contextType,
    contextKey,
    timestamp,
    snapshot: normalizeStormIntelSnapshot(r.payload),
  };
}
