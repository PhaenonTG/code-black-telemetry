import { describe, expect, it } from "vitest";
import { clusterViewportPoints } from "../../../src/map/viewport";
import { ACTIVE_SPOTTER_MAX_AGE_MS, isActiveSpotter } from "../../../src/services/spotters";

const points = [
  { id: "a", lat: 35.000, lon: -97.000 },
  { id: "b", lat: 35.020, lon: -97.020 },
];

describe("operational map density", () => {
  it("clusters dense cameras nationally and preserves them at ten-county zoom", () => {
    const national = clusterViewportPoints(points, { north: 50, south: 20, east: -60, west: -130, zoom: 4 }, { individualAtZoom: 6, farCellDegrees: 1.1 });
    expect(national).toHaveLength(1);
    expect("count" in national[0] && national[0].count).toBe(2);
    expect(clusterViewportPoints(points, { north: 40, south: 30, east: -90, west: -105, zoom: 6 }, { individualAtZoom: 6 })).toEqual(points);
  });

  it("shows only recent Spotter Network locations", () => {
    const now = Date.now();
    expect(isActiveSpotter({ updatedAtMs: now - ACTIVE_SPOTTER_MAX_AGE_MS }, now)).toBe(true);
    expect(isActiveSpotter({ updatedAtMs: now - ACTIVE_SPOTTER_MAX_AGE_MS - 1 }, now)).toBe(false);
    expect(isActiveSpotter({ updatedAtMs: null }, now)).toBe(false);
  });
});
