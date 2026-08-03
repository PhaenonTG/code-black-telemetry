import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { Spotter } from "../services/spotters";
import type { PinStyle } from "../services/settings";
import { syncAtlasPinMarkers } from "./AtlasPinMarkers";

// Per-map marker registry, same WeakMap-keyed-by-instance pattern AtlasRadarLayer.ts already uses
// for its source-state cache -- safe when more than one AtlasMap is mounted at once (Weather +
// Locate pages both render one).
const spotterMarkers = new WeakMap<MapboxMap, Record<string, Marker>>();

export function updateAtlasSpotterLayer(map: MapboxMap, spotters: Spotter[], style: PinStyle, visible: boolean) {
  let markers = spotterMarkers.get(map);
  if (!markers) {
    markers = {};
    spotterMarkers.set(map, markers);
  }
  const points = spotters.map((spotter) => ({ id: spotter.id, lat: spotter.lat, lon: spotter.lon }));
  syncAtlasPinMarkers(map, markers, points, style, visible);
}
