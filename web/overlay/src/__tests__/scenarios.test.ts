import { describe, expect, it } from "vitest";
import { buildHodograph, buildMetrics, publicLocationFor, scoreFromMetrics } from "../stormIntel/scenarios";
import { SIMULATION_SCENARIOS } from "../stormIntel/types";

describe("buildMetrics", () => {
  it("marks every metric unavailable (not zero) on provider_failure", () => {
    const { metrics } = buildMetrics("provider_failure", new Date());
    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) {
      expect(metric.availability).toBe("unavailable");
      expect(metric.value).toBeNull();
    }
  });

  it("marks every metric unavailable on unavailable_unit_location", () => {
    const { metrics } = buildMetrics("unavailable_unit_location", new Date());
    for (const metric of metrics) {
      expect(metric.availability).toBe("unavailable");
    }
  });

  it("omits specific keys as unavailable for partial_data without faking zero", () => {
    const { metrics } = buildMetrics("partial_data", new Date());
    const mucin = metrics.find((m) => m.key === "mucin");
    const mlcape = metrics.find((m) => m.key === "mlcape");
    expect(mucin?.availability).toBe("unavailable");
    expect(mucin?.value).toBeNull();
    expect(mlcape?.availability).toBe("available");
    expect(mlcape?.value).toBe(350);
  });

  it("distinguishes model valid time from retrieval time for stale_data", () => {
    const now = new Date("2026-09-04T18:00:00Z");
    const { metrics } = buildMetrics("stale_data", now);
    const mlcape = metrics.find((m) => m.key === "mlcape")!;
    expect(mlcape.retrievedAt).toBe(now.toISOString());
    expect(mlcape.source?.validTime).not.toBeNull();
    expect(new Date(mlcape.source!.validTime!).getTime()).toBeLessThan(now.getTime());
    expect(mlcape.freshness).toBe("stale");
  });

  it("classifies a recent valid time as current", () => {
    const now = new Date("2026-09-04T18:00:00Z");
    const { metrics } = buildMetrics("low_end", now);
    const mlcape = metrics.find((m) => m.key === "mlcape")!;
    expect(mlcape.freshness).toBe("current");
  });

  it("produces every scenario without throwing", () => {
    for (const scenario of SIMULATION_SCENARIOS) {
      expect(() => buildMetrics(scenario, new Date())).not.toThrow();
    }
  });
});

describe("scoreFromMetrics", () => {
  it("increases with environment severity", () => {
    const now = new Date();
    const low = scoreFromMetrics(buildMetrics("low_end", now).metrics);
    const severe = scoreFromMetrics(buildMetrics("severe_supercell", now).metrics);
    const highEnd = scoreFromMetrics(buildMetrics("high_end_tornadic", now).metrics);

    expect(low.value).not.toBeNull();
    expect(severe.value).not.toBeNull();
    expect(highEnd.value).not.toBeNull();
    expect(low.value!).toBeLessThan(severe.value!);
    expect(severe.value!).toBeLessThan(highEnd.value!);
  });

  it("is unavailable, never fabricated, when no inputs exist", () => {
    const { metrics } = buildMetrics("provider_failure", new Date());
    const score = scoreFromMetrics(metrics);
    expect(score.available).toBe(false);
    expect(score.value).toBeNull();
  });

  it("stays within the documented 0-10 range", () => {
    for (const scenario of ["low_end", "severe_supercell", "high_end_tornadic", "strong_cap_high_instability"] as const) {
      const score = scoreFromMetrics(buildMetrics(scenario, new Date()).metrics);
      expect(score.value).toBeGreaterThanOrEqual(0);
      expect(score.value).toBeLessThanOrEqual(10);
    }
  });
});

describe("buildHodograph", () => {
  it("returns an empty profile for provider_failure, not fake data", () => {
    const { metrics, source, freshness } = buildMetrics("provider_failure", new Date());
    const hodo = buildHodograph("provider_failure", metrics, source, freshness);
    expect(hodo.levels).toHaveLength(0);
    expect(hodo.freshness).toBe("unavailable");
  });

  it("carries srh/shear summary values consistent with the metrics", () => {
    const now = new Date();
    const { metrics, source, freshness } = buildMetrics("severe_supercell", now);
    const hodo = buildHodograph("severe_supercell", metrics, source, freshness);
    const srh01Metric = metrics.find((m) => m.key === "srh_0_1km");
    expect(hodo.srh01).toBe(srh01Metric?.value);
    expect(hodo.levels.length).toBeGreaterThan(1);
    expect(hodo.simulation).toBe(true);
  });
});

describe("publicLocationFor", () => {
  it("is null when the unit location is unavailable", () => {
    expect(publicLocationFor("unavailable_unit_location")).toBeNull();
  });

  it("never exposes exact coordinates, only city/state", () => {
    const location = publicLocationFor("low_end");
    expect(location).not.toBeNull();
    expect(location).not.toHaveProperty("latitude");
    expect(location).not.toHaveProperty("longitude");
  });
});
