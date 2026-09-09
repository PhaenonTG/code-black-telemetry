import type { Map } from "mapbox-gl";
import type { RadarFrame } from "../services/radar";
import { incrementAtlasCounter } from "./AtlasDiagnostics";
import type { AtlasRadarState } from "./types";

export const ATLAS_RADAR_SOURCE = "atlas-radar-tiles";
export const ATLAS_RADAR_LAYER = "atlas-radar-raster";
const sourceId = (id: string) => `${ATLAS_RADAR_SOURCE}-${id}`;
const layerId = (id: string) => `${ATLAS_RADAR_LAYER}-${id}`;
const radarFramesByMap = new WeakMap<Map, Set<string>>();

export function updateAtlasRadarLayer(map: Map, frame: RadarFrame | null, opacity: number, beforeLayerId?: string, loopFrames: RadarFrame[] = frame ? [frame] : []) {
  const mounted = radarFramesByMap.get(map) ?? new Set<string>();
  radarFramesByMap.set(map, mounted);
  const wanted = new Set(loopFrames.filter((item) => item.tileTemplate).map((item) => item.frameId));
  for (const item of loopFrames) {
    if (!item.tileTemplate) continue;
    const source = sourceId(item.frameId);
    const layer = layerId(item.frameId);
    if (!map.getSource(source)) {
      map.addSource(source, { type: "raster", tiles: [item.tileTemplate], tileSize: 256 });
      incrementAtlasCounter("sourceCreations");
    }
    if (!map.getLayer(layer)) {
      map.addLayer({ id: layer, type: "raster", source, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 420, delay: 0 }, "raster-fade-duration": 260, "raster-resampling": "nearest" } }, beforeLayerId);
      incrementAtlasCounter("layerCreations");
    }
    mounted.add(item.frameId);
  }
  for (const id of mounted) {
    const layer = layerId(id);
    if (map.getLayer(layer)) map.setPaintProperty(layer, "raster-opacity", frame?.frameId === id ? opacity : 0);
  }
  for (const id of [...mounted]) {
    if (wanted.has(id)) continue;
    if (map.getLayer(layerId(id))) map.removeLayer(layerId(id));
    if (map.getSource(sourceId(id))) map.removeSource(sourceId(id));
    mounted.delete(id);
  }
  if (!frame) return { loaded: false, error: "", state: "FRAME_MISSING" as AtlasRadarState };
  incrementAtlasCounter("radarImageUpdates");
  return { loaded: true, error: "", state: frame.freshness === "CACHED" ? "CACHED" as AtlasRadarState : frame.freshness === "STALE" ? "STALE" as AtlasRadarState : "LIVE" as AtlasRadarState };
}

export function removeAtlasRadarLayer(map: Map) {
  const mounted = radarFramesByMap.get(map) ?? new Set<string>();
  for (const id of mounted) {
    if (map.getLayer(layerId(id))) map.removeLayer(layerId(id));
    if (map.getSource(sourceId(id))) map.removeSource(sourceId(id));
  }
  radarFramesByMap.delete(map);
}
