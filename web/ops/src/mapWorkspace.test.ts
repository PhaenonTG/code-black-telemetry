import { describe, expect, it } from "vitest";
import type { MapLayerVisibility } from "../../../src/services/settings";
import { mapWorkspaceVisibility } from "./mapWorkspace";

const current: MapLayerVisibility = {
  warnings: true, watches: true, mesoscaleDiscussions: true, specialStatements: true,
  team: true, chasers: true, poi: true, mosaic: false, radar: true,
  roadConditions: true, trafficCameras: true, surfaceStations: false,
  stormReports: true, riverGauges: false, probes: false, chaserNet: true, breadcrumbs: true,
};

describe("map workspace baselines", () => {
  it("removes single-site radar from field intelligence", () => {
    expect(mapWorkspaceVisibility(current, "field")).toMatchObject({ radar: false, roadConditions: true, trafficCameras: true });
  });
  it("keeps radar focused and makes weather station-aware", () => {
    expect(mapWorkspaceVisibility(current, "radar")).toMatchObject({ radar: true, roadConditions: false, trafficCameras: false });
    expect(mapWorkspaceVisibility(current, "weather")).toMatchObject({ radar: false, surfaceStations: true, roadConditions: false });
  });
});
