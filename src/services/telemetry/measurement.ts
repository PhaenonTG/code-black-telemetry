export type MeasurementQuality = "VALID" | "AGING" | "STALE" | "MISSING" | "INVALID" | "UNAVAILABLE";

export interface NormalizedMeasurement<T = number> {
  value: T | null;
  timestamp: number | null;
  source: string;
  quality: MeasurementQuality;
  accuracy?: number | null;
  provenance?: string;
}

export interface MeasurementFreshnessPolicy {
  agingMs: number;
  staleMs: number;
}

export const TELEMETRY_FRESHNESS_POLICIES = {
  gps: { agingMs: 15_000, staleMs: 90_000 },
  vehicle: { agingMs: 30_000, staleMs: 180_000 },
  weather: { agingMs: 300_000, staleMs: 900_000 },
  externalWeather: { agingMs: 900_000, staleMs: 3_600_000 },
} as const satisfies Record<string, MeasurementFreshnessPolicy>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function ageSeconds(updatedAt: number | null | undefined, now = Date.now()): number | null {
  if (!isFiniteNumber(updatedAt) || updatedAt <= 0) return null;
  return Math.max(0, Math.round((now - updatedAt) / 1000));
}

export function measurementQuality(
  value: unknown,
  timestamp: number | null | undefined,
  now = Date.now(),
  policy: MeasurementFreshnessPolicy = TELEMETRY_FRESHNESS_POLICIES.vehicle,
): MeasurementQuality {
  if (value == null) return timestamp ? "MISSING" : "UNAVAILABLE";
  if (typeof value === "number" && !isFiniteNumber(value)) return "INVALID";
  const age = ageSeconds(timestamp, now);
  if (age === null) return "MISSING";
  const ageMs = age * 1000;
  if (ageMs > policy.staleMs) return "STALE";
  if (ageMs > policy.agingMs) return "AGING";
  return "VALID";
}

export function createMeasurement<T = number>({
  value,
  timestamp,
  source,
  now,
  policy,
  accuracy,
  provenance,
}: {
  value: T | null | undefined;
  timestamp: number | null | undefined;
  source: string;
  now?: number;
  policy?: MeasurementFreshnessPolicy;
  accuracy?: number | null;
  provenance?: string;
}): NormalizedMeasurement<T> {
  return {
    value: value ?? null,
    timestamp: timestamp ?? null,
    source,
    quality: measurementQuality(value, timestamp, now, policy),
    accuracy,
    provenance,
  };
}
