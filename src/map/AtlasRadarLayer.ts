import type { Map } from "mapbox-gl";
import type { RadarFrame } from "../services/radar";
import { incrementAtlasCounter } from "./AtlasDiagnostics";
import type { AtlasRadarState } from "./types";

export const ATLAS_RADAR_SOURCE = "atlas-radar-tiles";
export const ATLAS_RADAR_LAYER = "atlas-radar-raster";

const radarSourceState = new WeakMap<Map, { tileTemplate: string }>();

export function updateAtlasRadarLayer(map: Map, frame: RadarFrame | null, opacity: number, beforeLayerId?: string) {
  if (!frame) {
    if (map.getLayer(ATLAS_RADAR_LAYER)) map.setLayoutProperty(ATLAS_RADAR_LAYER, "visibility", "none");
    return { loaded: false, error: "", state: "FRAME_MISSING" as AtlasRadarState };
  }
  if (!frame.tileTemplate) {
    if (map.getLayer(ATLAS_RADAR_LAYER)) map.setLayoutProperty(ATLAS_RADAR_LAYER, "visibility", "none");
    return { loaded: false, error: "RADAR_TILES_MISSING", state: "IMAGE_MISSING" as AtlasRadarState };
  }

  const existing = map.getSource(ATLAS_RADAR_SOURCE);
  const previous = radarSourceState.get(map);
  // A new frame (new scan, or a different site/product) means a different tile template --
  // raster sources can't be retargeted in place, so swap layer+source together rather than
  // trying to mutate an existing tile source.
  if (existing && previous?.tileTemplate !== frame.tileTemplate) {
    if (map.getLayer(ATLAS_RADAR_LAYER)) map.removeLayer(ATLAS_RADAR_LAYER);
    map.removeSource(ATLAS_RADAR_SOURCE);
    radarSourceState.delete(map);
  }

  if (!map.getSource(ATLAS_RADAR_SOURCE)) {
    map.addSource(ATLAS_RADAR_SOURCE, {
      type: "raster",
      tiles: [frame.tileTemplate],
      tileSize: 256,
    });
    radarSourceState.set(map, { tileTemplate: frame.tileTemplate });
    incrementAtlasCounter("sourceCreations");
    incrementAtlasCounter("radarImageUpdates");
  }

  if (!map.getLayer(ATLAS_RADAR_LAYER)) {
    map.addLayer({
      id: ATLAS_RADAR_LAYER,
      type: "raster",
      source: ATLAS_RADAR_SOURCE,
      paint: {
        "raster-opacity": opacity,
        "raster-fade-duration": 180,
        "raster-resampling": "nearest",
      },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  } else {
    map.setLayoutProperty(ATLAS_RADAR_LAYER, "visibility", "visible");
    map.setPaintProperty(ATLAS_RADAR_LAYER, "raster-opacity", opacity);
  }

  return { loaded: true, error: "", state: frame.freshness === "CACHED" ? "CACHED" as AtlasRadarState : frame.freshness === "STALE" ? "STALE" as AtlasRadarState : "LIVE" as AtlasRadarState };
}

export function removeAtlasRadarLayer(map: Map) {
  if (map.getLayer(ATLAS_RADAR_LAYER)) map.removeLayer(ATLAS_RADAR_LAYER);
  if (map.getSource(ATLAS_RADAR_SOURCE)) map.removeSource(ATLAS_RADAR_SOURCE);
  radarSourceState.delete(map);
}
