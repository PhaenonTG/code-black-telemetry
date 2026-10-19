import { describe, expect, it } from "vitest";
import type { StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";
import type { StormIntelHistoryEntry } from "../core/types";
import { addPointHistoryEntry, historyEntryFromSnapshot, POINT_HISTORY_LIMIT } from "./pointHistory";

const snapshot: StormIntelSnapshot = {
  schema: "codeblack.storm-intel.snapshot",
  schemaVersion: "1.0.0",
  generatedAt: "2026-09-06T19:15:00Z",
  context: {
    contextType: "SELECTED_TARGET",
    requestedAt: "2026-09-06T19:14:59Z",
    location: {
      available: true,
      latitude: 36.45,
      longitude: -94.12,
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
  metrics: [
    {
      key: "mlcape",
      label: "MLCAPE",
      value: 1250,
      unit: "J/kg",
      source: {
        provider: "NOAA",
        product: "HRRR",
        runTime: "2026-09-06T18:00:00Z",
        validTime: "2026-09-06T20:00:00Z",
        formulation: "direct model field",
        forecastHour: 2,
        dataClass: "MODEL_FORECAST",
        resolvedLatitude: 36.46,
        resolvedLongitude: -94.11,
        gridDistanceKm: 1.4,
      },
      retrievedAt: "2026-09-06T19:10:00Z",
      ageSeconds: 300,
      freshness: "current",
      quality: "nominal",
      availability: "available",
      unavailableReason: null,
      trend: null,
      derivation: "direct model field",
      dataClass: "MODEL_FORECAST",
    },
  ],
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

describe("point history", () => {
  it("captures requested/resolved coordinates and model provenance", () => {
    const entry = historyEntryFromSnapshot({ lat: 36.45, lon: -94.12 }, snapshot, 1000);
    expect(entry.requested).toEqual({ lat: 36.45, lon: -94.12 });
    expect(entry.resolved).toEqual({ lat: 36.46, lon: -94.11 });
    expect(entry.product).toBe("HRRR");
    expect(entry.dataClass).toBe("MODEL_FORECAST");
  });

  it("deduplicates near-identical points and keeps newest first", () => {
    const first = historyEntryFromSnapshot({ lat: 36.45, lon: -94.12 }, snapshot, 1000);
    const second = historyEntryFromSnapshot({ lat: 36.451, lon: -94.119 }, snapshot, 2000);
    const history = addPointHistoryEntry(addPointHistoryEntry([], first), second);
    expect(history).toHaveLength(1);
    expect(history[0].selectedAt).toBe(2000);
  });

  it("bounds history length", () => {
    let history: StormIntelHistoryEntry[] = [];
    for (let i = 0; i < POINT_HISTORY_LIMIT + 4; i += 1) {
      history = addPointHistoryEntry(history, historyEntryFromSnapshot({ lat: 30 + i, lon: -90 - i }, snapshot, i));
    }
    expect(history).toHaveLength(POINT_HISTORY_LIMIT);
    expect(history[0].selectedAt).toBe(POINT_HISTORY_LIMIT + 3);
  });
});
