import type { ImageSource, Map } from "mapbox-gl";
import type { RadarFrame } from "../services/radar";
import { incrementAtlasCounter } from "./AtlasDiagnostics";
import type { AtlasRadarState } from "./types";

export const ATLAS_RADAR_SOURCE = "atlas-radar-image";
export const ATLAS_RADAR_LAYER = "atlas-radar-raster";

const radarSourceState = new WeakMap<Map, { imageUrl: string; coordinatesKey: string }>();

function radarCoordinates(frame: RadarFrame): [[number, number], [number, number], [number, number], [number, number]] | null {
  if (!frame.bounds) return null;
  const { west, south, east, north } = frame.bounds;
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return [[west, north], [east, north], [east, south], [west, south]];
}

function coordinatesKey(coordinates: [[number, number], [number, number], [number, number], [number, number]]) {
  return coordinates.map(([lon, lat]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join("|");
}

export function updateAtlasRadarLayer(map: Map, frame: RadarFrame | null, opacity: number, beforeLayerId?: string) {
  if (!frame) {
    if (map.getLayer(ATLAS_RADAR_LAYER)) map.setLayoutProperty(ATLAS_RADAR_LAYER, "visibility", "none");
    return { loaded: false, error: "", state: "FRAME_MISSING" as AtlasRadarState };
  }
  if (!frame.imageUrl) {
    if (map.getLayer(ATLAS_RADAR_LAYER)) map.setLayoutProperty(ATLAS_RADAR_LAYER, "visibility", "none");
    return { loaded: false, error: "RADAR_IMAGE_MISSING", state: "IMAGE_MISSING" as AtlasRadarState };
  }
  const coordinates = radarCoordinates(frame);
  if (!coordinates) {
    if (map.getLayer(ATLAS_RADAR_LAYER)) map.setLayoutProperty(ATLAS_RADAR_LAYER, "visibility", "none");
    return { loaded: false, error: "RADAR_BOUNDS_INVALID", state: "BOUNDS_INVALID" as AtlasRadarState };
  }

  const existing = map.getSource(ATLAS_RADAR_SOURCE) as ImageSource | undefined;
  if (existing) {
    const nextKey = coordinatesKey(coordinates);
    const previous = radarSourceState.get(map);
    if (!previous || previous.imageUrl !== frame.imageUrl || previous.coordinatesKey !== nextKey) {
      existing.updateImage({ url: frame.imageUrl, coordinates });
      radarSourceState.set(map, { imageUrl: frame.imageUrl, coordinatesKey: nextKey });
      incrementAtlasCounter("sourceUpdates");
      incrementAtlasCounter("radarImageUpdates");
    }
  } else {
    map.addSource(ATLAS_RADAR_SOURCE, {
      type: "image",
      url: frame.imageUrl,
      coordinates,
    });
    radarSourceState.set(map, { imageUrl: frame.imageUrl, coordinatesKey: coordinatesKey(coordinates) });
    incrementAtlasCounter("sourceCreations");
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
