import { describe, expect, it } from "vitest";
import { formatAge, formatMetricValue, formatScore, formatTrend } from "../utils/format";
import { presentFreshness } from "../utils/freshness";
import type { NormalizedMetric } from "../stormIntel/types";

function metric(overrides: Partial<NormalizedMetric>): NormalizedMetric {
  return {
    key: "mlcape",
    label: "Mixed-Layer CAPE",
    value: 1234,
    unit: "J/kg",
    source: null,
    retrievedAt: null,
    ageSeconds: null,
    freshness: "current",
    quality: null,
    availability: "available",
    unavailableReason: null,
    trend: null,
    derivation: null,
    ...overrides,
  };
}

describe("formatMetricValue", () => {
  it("renders -- for a null value instead of 0", () => {
    expect(formatMetricValue(metric({ value: null }))).toBe("--");
  });

  it("rounds large values to whole numbers", () => {
    expect(formatMetricValue(metric({ value: 2456.7 }))).toBe("2457");
  });

  it("keeps one decimal place for small values", () => {
    expect(formatMetricValue(metric({ key: "lapse_rate_0_3km", value: 6.53 }))).toBe("6.5");
  });
});

describe("formatAge", () => {
  it("handles null", () => {
    expect(formatAge(null)).toBe("--");
  });
  it("formats seconds", () => {
    expect(formatAge(42)).toBe("42s");
  });
  it("formats minutes", () => {
    expect(formatAge(125)).toBe("2m");
  });
  it("formats hours and minutes", () => {
    expect(formatAge(3 * 3600 + 5 * 60)).toBe("3h 5m");
  });
});

describe("formatTrend", () => {
  it("returns null when no trend is present", () => {
    expect(formatTrend(metric({ trend: null }))).toBeNull();
  });

  it("shows a rising arrow", () => {
    expect(
      formatTrend(metric({ trend: { direction: "rising", delta: 180, periodMinutes: 30 } })),
    ).toBe("↑180");
  });

  it("shows a falling arrow", () => {
    expect(
      formatTrend(metric({ trend: { direction: "falling", delta: -50, periodMinutes: 30 } })),
    ).toBe("↓50");
  });
});

describe("formatScore", () => {
  it("handles null", () => {
    expect(formatScore(null)).toBe("--");
  });
  it("formats to one decimal", () => {
    expect(formatScore(8.2)).toBe("8.2");
    expect(formatScore(4)).toBe("4.0");
  });
});

describe("presentFreshness", () => {
  it("maps every freshness state to a label", () => {
    expect(presentFreshness("current").label).toBe("CURRENT");
    expect(presentFreshness("aging").label).toBe("AGING");
    expect(presentFreshness("stale").label).toBe("STALE");
    expect(presentFreshness("unavailable").label).toBe("UNAVAILABLE");
    expect(presentFreshness("unknown").label).toBe("UNKNOWN");
  });
});
