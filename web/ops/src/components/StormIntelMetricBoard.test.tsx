import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { NormalizedMetric, StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";
import type { OpsCoreState } from "../core/types";
import { StormIntelActions } from "./StormIntelActions";
import { StormIntelMetricBoard } from "./StormIntelMetricBoard";

function metric(overrides: Partial<NormalizedMetric> = {}): NormalizedMetric {
  return {
    key: "mlcape",
    label: "MLCAPE",
    value: 2200,
    unit: "J/kg",
    source: {
      provider: "NOAA",
      product: "HRRR",
      runTime: "2026-09-06T18:00:00Z",
      validTime: "2026-09-06T19:00:00Z",
      formulation: "calculated from profile",
      forecastHour: 1,
      dataClass: "MODEL_ANALYSIS",
      resolvedLatitude: 35.22,
      resolvedLongitude: -97.44,
      gridDistanceKm: 2.1,
    },
    retrievedAt: "2026-09-06T19:00:30Z",
    ageSeconds: 30,
    freshness: "current",
    quality: "nominal",
    availability: "available",
    unavailableReason: null,
    trend: null,
    derivation: "calculated from profile",
    dataClass: "MODEL_ANALYSIS",
    ...overrides,
  };
}

function state(metrics: NormalizedMetric[]): OpsCoreState {
  const snapshot: StormIntelSnapshot = {
    schema: "codeblack.storm-intel.snapshot",
    schemaVersion: "1.0.0",
    generatedAt: "2026-09-06T19:01:00Z",
    context: {
      contextType: "SELECTED_TARGET",
      requestedAt: "2026-09-06T19:00:00Z",
      location: {
        available: true,
        latitude: 35.22,
        longitude: -97.44,
        resolvedFrom: "explicit_target",
        unitId: null,
        unitPositionObservedAt: null,
        unitPositionHealthState: null,
        headingDeg: null,
        distanceMiles: null,
        unavailableReason: null,
      },
    },
    providerName: "hrrr",
    simulation: false,
    metrics,
    score: {
      available: false,
      value: null,
      label: "NO SCORE",
      algorithmId: "none",
      algorithmVersion: "0",
      inputsUsed: [],
      unavailableReason: "not supported",
    },
    canonicalUnits: {},
    available: true,
    unavailableReason: null,
  };
  const now = Date.now();
  return {
    refreshedAt: now,
    core: { state: "LIVE", detail: "healthy", checkedAt: now },
    fabric: {
      state: "LIVE",
      detail: "ready",
      checkedAt: now,
      health: null,
      units: null,
      wsState: "open",
      lastWsEventAt: now,
      lastContactAt: now,
      error: null,
    },
    stormIntel: {
      state: "LIVE",
      detail: "ready",
      checkedAt: now,
      health: null,
      selectedPoint: { lat: 35.22, lon: -97.44 },
      pointLoading: false,
      requestId: 1,
      pointSnapshot: snapshot,
      pointError: null,
      pointHistory: [],
    },
  };
}

describe("StormIntelMetricBoard", () => {
  it("renders grouped MODEL_ANALYSIS metrics with calculated/proxy/unavailable semantics", () => {
    const html = renderToString(<StormIntelMetricBoard coreState={state([
      metric(),
      metric({ key: "mucape", label: "MUCAPE", derivation: "MUCAPE proxy" }),
      metric({ key: "srh_0_1km", label: "0-1 km SRH", availability: "unavailable", value: null, unavailableReason: "not exposed", source: null, dataClass: null }),
    ])} />);
    expect(html).toContain("INSTABILITY");
    expect(html).toContain("LOW-LEVEL / TORNADO ENVIRONMENT");
    expect(html).toContain("MODEL_ANALYSIS");
    expect(html).toContain("CALCULATED");
    expect(html).toContain("PROXY");
    expect(html).toContain("UNAVAILABLE");
  });

  it("renders Sounding and Consensus actions as disabled development placeholders", () => {
    const html = renderToString(<StormIntelActions coreState={state([metric()])} />);
    expect(html).toContain("SOUNDING SNAPSHOT");
    expect(html).toContain("Vertical profile endpoint not yet available");
    expect(html).toContain("VIEW IN CONSENSUS");
    expect(html).toContain("Consensus remains development-only");
  });
});
