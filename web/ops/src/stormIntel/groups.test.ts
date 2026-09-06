import { describe, expect, it } from "vitest";
import type { NormalizedMetric, StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";
import { metricsForGroup, STORM_METRIC_GROUPS } from "./groups";

function metric(key: NormalizedMetric["key"], availability: NormalizedMetric["availability"] = "available"): NormalizedMetric {
  return {
    key,
    label: key.toUpperCase(),
    value: availability === "available" ? 1 : null,
    unit: null,
    source: null,
    retrievedAt: null,
    ageSeconds: null,
    freshness: availability === "available" ? "current" : "unavailable",
    quality: null,
    availability,
    unavailableReason: availability === "available" ? null : "not supplied",
    trend: null,
    derivation: availability === "available" ? "direct model field" : null,
    dataClass: availability === "available" ? "MODEL_ANALYSIS" : null,
  };
}

const snapshot = {
  metrics: [metric("mlcape"), metric("mlcin"), metric("bulk_shear_0_6km"), metric("surface_dewpoint", "unavailable")],
} as StormIntelSnapshot;

describe("Storm Intel metric groups", () => {
  it("groups only metrics supplied by the normalized contract", () => {
    const instability = STORM_METRIC_GROUPS.find((group) => group.id === "instability");
    expect(instability).toBeDefined();
    expect(metricsForGroup(snapshot, instability!).map((metric) => metric.key)).toEqual(["mlcape", "mlcin"]);
  });

  it("keeps unavailable supplied metrics visible", () => {
    const thermo = STORM_METRIC_GROUPS.find((group) => group.id === "thermo");
    expect(metricsForGroup(snapshot, thermo!)[0].availability).toBe("unavailable");
  });
});
