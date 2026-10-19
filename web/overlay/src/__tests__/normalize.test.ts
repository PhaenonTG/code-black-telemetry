import { describe, expect, it } from "vitest";
import { normalizeStormIntelEvent, normalizeStormIntelSnapshot, StormIntelNormalizationError } from "../stormIntel/normalize";

// Shaped exactly like real Core wire JSON (snake_case `model_dump()` output) --
// see docs/design/overlay-data-flow-audit.md for why this is the wire format, not camelCase.
function wireSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schema: "codeblack.storm-intel.snapshot",
    schema_version: "1.0.0",
    generated_at: "2026-06-04T21:00:00Z",
    context: {
      context_type: "AT_UNIT",
      location: {
        available: true,
        latitude: 35.22,
        longitude: -97.44,
        resolved_from: "unit_position",
        unit_id: "cbwx-unit-striker",
        unit_position_observed_at: "2026-06-04T21:00:00Z",
        unit_position_health_state: "LIVE",
        heading_deg: null,
        distance_miles: null,
        unavailable_reason: null,
      },
      requested_at: "2026-06-04T21:00:00Z",
    },
    provider_name: "hrrr-nomads",
    simulation: false,
    metrics: [
      {
        key: "mlcape",
        label: "Mixed-Layer CAPE",
        value: 2200,
        unit: "J/kg",
        source: {
          provider: "hrrr-nomads",
          product: "conus2d",
          run_time: "2026-06-04T18:00:00Z",
          valid_time: "2026-06-04T18:00:00Z",
          formulation: null,
        },
        retrieved_at: "2026-06-04T20:55:00Z",
        age_seconds: 300,
        freshness: "current",
        quality: "nominal",
        availability: "available",
        unavailable_reason: null,
        trend: { direction: "rising", delta: 300, period_minutes: 60 },
        derivation: null,
      },
    ],
    score: {
      available: true,
      value: 6.9,
      label: "Code Black Storm Environment Score (experimental, Code Black-derived)",
      algorithm_id: "codeblack-storm-intel-score-prototype",
      algorithm_version: "0.1.0-experimental",
      inputs_used: ["mlcape"],
      unavailable_reason: null,
    },
    canonical_units: { mlcape: "J/kg" },
    available: true,
    unavailable_reason: null,
    ...overrides,
  };
}

describe("normalizeStormIntelSnapshot", () => {
  it("converts real snake_case Core wire JSON into the camelCase overlay contract", () => {
    const result = normalizeStormIntelSnapshot(wireSnapshot());
    expect(result.generatedAt).toBe("2026-06-04T21:00:00Z");
    expect(result.providerName).toBe("hrrr-nomads");
    expect(result.context.contextType).toBe("AT_UNIT");
    expect(result.context.location.latitude).toBe(35.22);
    expect(result.context.location.unitId).toBe("cbwx-unit-striker");
    expect(result.metrics[0].key).toBe("mlcape");
    expect(result.metrics[0].value).toBe(2200);
    expect(result.metrics[0].source?.runTime).toBe("2026-06-04T18:00:00Z");
    expect(result.metrics[0].trend?.periodMinutes).toBe(60);
    expect(result.score.algorithmId).toBe("codeblack-storm-intel-score-prototype");
  });

  it("derives dataClass on each metric during normalization", () => {
    const result = normalizeStormIntelSnapshot(wireSnapshot());
    expect(result.metrics[0].dataClass).toBe("MODEL_ANALYSIS");
  });

  it("tolerates unknown/new wire fields instead of crashing (forward compatibility)", () => {
    const raw = wireSnapshot({ some_future_field: { nested: true }, metrics: [] });
    (raw as Record<string, unknown>).context = {
      ...(raw as { context: Record<string, unknown> }).context,
      a_new_context_field: 42,
    };
    expect(() => normalizeStormIntelSnapshot(raw)).not.toThrow();
  });

  it("rejects the wrong schema instead of guessing", () => {
    expect(() => normalizeStormIntelSnapshot(wireSnapshot({ schema: "something.else" }))).toThrow(
      StormIntelNormalizationError,
    );
  });

  it("rejects a missing required field rather than rendering garbage", () => {
    const raw = wireSnapshot();
    delete (raw as Record<string, unknown>).generated_at;
    expect(() => normalizeStormIntelSnapshot(raw)).toThrow(StormIntelNormalizationError);
  });

  it("rejects a non-object payload", () => {
    expect(() => normalizeStormIntelSnapshot("not an object")).toThrow(StormIntelNormalizationError);
    expect(() => normalizeStormIntelSnapshot(null)).toThrow(StormIntelNormalizationError);
  });

  it("rejects metrics that are not an array", () => {
    expect(() => normalizeStormIntelSnapshot(wireSnapshot({ metrics: "nope" }))).toThrow(StormIntelNormalizationError);
  });
});

describe("normalizeStormIntelEvent", () => {
  it("normalizes a real storm_intel.updated WebSocket envelope", () => {
    const raw = {
      event_type: "storm_intel.updated",
      schema_version: "1.0.0",
      timestamp: "2026-06-04T21:00:00Z",
      context_type: "AT_UNIT",
      context_key: "unit:cbwx-unit-striker",
      payload: wireSnapshot(),
    };
    const result = normalizeStormIntelEvent(raw);
    expect(result.contextKey).toBe("unit:cbwx-unit-striker");
    expect(result.snapshot.providerName).toBe("hrrr-nomads");
  });

  it("rejects an event with the wrong event_type", () => {
    const raw = {
      event_type: "something.else",
      timestamp: "2026-06-04T21:00:00Z",
      context_type: "AT_UNIT",
      context_key: "unit:cbwx-unit-striker",
      payload: wireSnapshot(),
    };
    expect(() => normalizeStormIntelEvent(raw)).toThrow(StormIntelNormalizationError);
  });

  it("rejects a malformed event envelope (missing context_key)", () => {
    const raw = {
      event_type: "storm_intel.updated",
      timestamp: "2026-06-04T21:00:00Z",
      context_type: "AT_UNIT",
      payload: wireSnapshot(),
    };
    expect(() => normalizeStormIntelEvent(raw)).toThrow(StormIntelNormalizationError);
  });
});
