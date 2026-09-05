import { describe, expect, it } from "vitest";
import { classifyDataClass } from "../stormIntel/dataClass";
import type { MetricSource } from "../stormIntel/types";

function source(overrides: Partial<MetricSource>): MetricSource {
  return { provider: "hrrr-nomads", product: "conus2d", runTime: null, validTime: null, formulation: null, ...overrides };
}

describe("classifyDataClass", () => {
  it("returns null when source is null (unavailable metric)", () => {
    expect(classifyDataClass(null)).toBeNull();
  });

  it("classifies analysis (valid time == run time) as MODEL_ANALYSIS", () => {
    const s = source({ runTime: "2026-06-04T18:00:00Z", validTime: "2026-06-04T18:00:00Z" });
    expect(classifyDataClass(s)).toBe("MODEL_ANALYSIS");
  });

  it("classifies a forecast hour ahead of run time as MODEL_FORECAST", () => {
    const s = source({ runTime: "2026-06-04T18:00:00Z", validTime: "2026-06-04T21:00:00Z" });
    expect(classifyDataClass(s)).toBe("MODEL_FORECAST");
  });

  it("treats a sub-hour run/valid gap as rounding noise, not a forecast", () => {
    // Mirrors the simulator's own runTime-rounded-to-hour construction.
    const s = source({ runTime: "2026-06-04T18:00:00Z", validTime: "2026-06-04T18:06:00Z" });
    expect(classifyDataClass(s)).toBe("MODEL_ANALYSIS");
  });

  it("defaults to MODEL_ANALYSIS when run/valid time is missing -- never defaults to OBSERVATION", () => {
    const s = source({ runTime: null, validTime: null });
    expect(classifyDataClass(s)).toBe("MODEL_ANALYSIS");
  });

  it("never classifies the current Core provider set as OBSERVATION", () => {
    // Core ships only hrrr-nomads today (a pure NWP model) -- confirmed against the real
    // provider source. This must never accidentally read as an observation.
    const s = source({ provider: "hrrr-nomads" });
    expect(classifyDataClass(s)).not.toBe("OBSERVATION");
  });
});
