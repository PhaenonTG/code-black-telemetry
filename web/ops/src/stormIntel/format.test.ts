import { describe, expect, it } from "vitest";
import { formatMetric, metricProvenance, sourceSemantics, stormIntelSummary } from "./format";
import type { NormalizedMetric, StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";

function metric(overrides: Partial<NormalizedMetric> = {}): NormalizedMetric {
  return {
    key: "mlcape",
    label: "MLCAPE",
    value: 1840,
    unit: "J/kg",
    source: {
      provider: "hrrr-nomads",
      product: "sfc",
      runTime: "2026-09-06T12:00:00Z",
      validTime: "2026-09-06T18:00:00Z",
      formulation: "direct",
      forecastHour: 6,
      dataClass: "MODEL_FORECAST",
      resolvedLatitude: 35.22,
      resolvedLongitude: -97.44,
      gridDistanceKm: 1.2,
    },
    retrievedAt: "2026-09-06T12:10:00Z",
    ageSeconds: 120,
    freshness: "current",
    quality: "nominal",
    availability: "available",
    unavailableReason: null,
    trend: null,
    derivation: "direct model field",
    dataClass: "MODEL_FORECAST",
    ...overrides,
  };
}

describe("Storm Intel formatting", () => {
  it("does not hide unavailable metrics", () => {
    expect(formatMetric(metric({ value: null, availability: "unavailable", unavailableReason: "not exposed" }))).toBe("UNAVAILABLE");
  });

  it("prints data class and model provenance", () => {
    expect(metricProvenance(metric())).toContain("MODEL_FORECAST");
    expect(metricProvenance(metric())).toContain("hrrr-nomads");
    expect(metricProvenance(metric())).toContain("FH 6");
  });

  it("labels direct, calculated, proxy, and unavailable semantics", () => {
    expect(sourceSemantics(metric({ derivation: "direct model field" }))).toBe("DIRECT");
    expect(sourceSemantics(metric({ derivation: "calculated from profile" }))).toBe("CALCULATED");
    expect(sourceSemantics(metric({ derivation: "MUCAPE proxy" }))).toBe("PROXY");
    expect(sourceSemantics(metric({ availability: "unavailable", value: null }))).toBe("UNAVAILABLE");
  });

  it("summarizes unavailable snapshots honestly", () => {
    const snapshot = {
      available: false,
      unavailableReason: "provider unavailable",
      providerName: "hrrr-nomads",
      context: { contextType: "SELECTED_TARGET" },
      score: { available: false, value: null },
    } as StormIntelSnapshot;
    expect(stormIntelSummary(snapshot)).toBe("provider unavailable");
  });
});
