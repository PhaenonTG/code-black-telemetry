import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { Spotter } from "../services/spotters";
import type { PinStyle } from "../services/settings";
import { syncAtlasPinMarkers } from "./AtlasPinMarkers";
import type { MapCluster } from "./viewport";

// Per-map marker registry, same WeakMap-keyed-by-instance pattern AtlasRadarLayer.ts already uses
// for its source-state cache -- safe when more than one AtlasMap is mounted at once (Weather +
// Locate pages both render one).
const spotterMarkers = new WeakMap<MapboxMap, Record<string, Marker>>();

function isCluster(point: Spotter | MapCluster<Spotter>): point is MapCluster<Spotter> {
  return "count" in point;
}

export function updateAtlasSpotterLayer(map: MapboxMap, spotters: Array<Spotter | MapCluster<Spotter>>, style: PinStyle, visible: boolean) {
  let markers = spotterMarkers.get(map);
  if (!markers) {
    markers = {};
    spotterMarkers.set(map, markers);
  }
  const points = spotters.map((spotter) => isCluster(spotter)
    ? { id: spotter.id, lat: spotter.lat, lon: spotter.lon, name: `${spotter.count} chasers`, clusterCount: spotter.count, family: "chaser" as const }
    : { id: spotter.id, lat: spotter.lat, lon: spotter.lon, name: spotter.name, updatedAtText: spotter.updatedAtText, family: "chaser" as const });
  syncAtlasPinMarkers(map, markers, points, style, visible);
}
