import type { MapLayerVisibility } from "../../../src/services/settings";

export type MapWorkspace = "operations" | "radar" | "field" | "weather";

export function mapWorkspaceVisibility(current: MapLayerVisibility, workspace: MapWorkspace): MapLayerVisibility {
  const common = { ...current, mosaic: true, poi: false };
  switch (workspace) {
    case "radar": return { ...common, radar: true, roadConditions: false, trafficCameras: false, surfaceStations: false };
    case "field": return { ...common, radar: false, roadConditions: true, trafficCameras: true, chasers: true, surfaceStations: false };
    case "weather": return { ...common, radar: false, roadConditions: false, trafficCameras: false, surfaceStations: true };
    case "operations": return { ...common, radar: false, roadConditions: false, trafficCameras: false, surfaceStations: false };
  }
}
