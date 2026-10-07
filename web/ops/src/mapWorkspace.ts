import type { MapLayerVisibility } from "../../../src/services/settings";

export type MapWorkspace = "operations" | "radar" | "field" | "weather";

export const PHONE_RADAR_LAYERS: MapLayerVisibility = {
  warnings: true, watches: true, mesoscaleDiscussions: false, specialStatements: false,
  radar: true, mosaic: false, team: false, chasers: false, poi: false,
  roadConditions: false, trafficCameras: false, surfaceStations: false,
  stormReports: false, riverGauges: false, probes: false, chaserNet: false, breadcrumbs: false,
};

export function mapWorkspaceVisibility(current: MapLayerVisibility, workspace: MapWorkspace): MapLayerVisibility {
  const common = { ...current, mosaic: true, poi: false };
  switch (workspace) {
    case "radar": return { ...common, radar: true, roadConditions: false, trafficCameras: false, surfaceStations: false };
    case "field": return { ...common, radar: false, roadConditions: true, trafficCameras: true, chasers: true, surfaceStations: false };
    case "weather": return { ...common, radar: false, roadConditions: false, trafficCameras: false, surfaceStations: true };
    case "operations": return { ...common, radar: false, roadConditions: false, trafficCameras: false, surfaceStations: false };
  }
}
