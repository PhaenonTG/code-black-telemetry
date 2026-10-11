import { describe, expect, it } from "vitest";
import { normalizeStormIntelSnapshot } from "../../../overlay/src/stormIntel/normalize";
import { toPublicStormIntelPoint, validPoint } from "./publicStormIntelRelay";

const raw = {
  schema: "codeblack.storm-intel.snapshot",
  provider_name: "HRRR",
  generated_at: "2026-10-11T17:00:00Z",
  context: {
    context_type: "SELECTED_TARGET",
    requested_at: "2026-10-11T17:00:00Z",
    location: {
      available: true, latitude: 30.4, longitude: -88.3,
      resolved_from: "explicit_target", unit_id: "private-unit-id",
      unit_position_observed_at: "private-time", unit_position_health_state: "LIVE",
      heading_deg: 90, distance_miles: 1,
    },
  },
  metrics: [],
  score: { available: false, value: null, label: "Unavailable", algorithm_id: "test", algorithm_version: "1", inputs_used: [] },
  canonical_units: {}, available: false,
  private_extra: { operator_name: "private-name" },
};

describe("public Storm Intel boundary", () => {
  it("accepts only finite, bounded point coordinates", () => {
    expect(validPoint(new URL("https://ops.example/point?latitude=30.4&longitude=-88.3"))).toBe(true);
    for (const query of ["latitude=NaN&longitude=1", "latitude=91&longitude=1", "latitude=1&longitude=181", "latitude=1&longitude="]) {
      expect(validPoint(new URL(`https://ops.example/point?${query}`))).toBe(false);
    }
  });

  it("projects only public fields while retaining a valid overlay wire contract", () => {
    const projected = toPublicStormIntelPoint(raw);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("private-unit-id");
    expect(serialized).not.toContain("private-name");
    expect(serialized).not.toContain("private-time");
    expect(normalizeStormIntelSnapshot(projected).context.location.unitId).toBeNull();
  });

  it("rejects a unit-context response from Core", () => {
    expect(() => toPublicStormIntelPoint({ ...raw, context: { ...raw.context, context_type: "AT_UNIT" } })).toThrow();
  });
});
