import { describe, expect, it } from "vitest";
import { recommendedRadarRefreshMs } from "../../../../src/services/radar";

describe("recommendedRadarRefreshMs", () => {
  it("polls fast enough on web (no Capacitor native bridge) to realize the chunk-assembler's freshness gain within the 5-15s recommended band", () => {
    // Vitest/jsdom has no native Capacitor bridge, so Capacitor.isNativePlatform() is false
    // here -- exactly OPS's real runtime environment. Native's own (slower, battery-conscious)
    // value is exercised implicitly by every native build; this environment can only prove
    // the web path.
    const ms = recommendedRadarRefreshMs();
    expect(ms).toBeGreaterThanOrEqual(5_000);
    expect(ms).toBeLessThanOrEqual(15_000);
  });
});
