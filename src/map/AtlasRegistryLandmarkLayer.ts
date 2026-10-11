import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { MapSourceRecord } from "../services/mapSourceRegistry";
import { syncAtlasPinMarkers } from "./AtlasPinMarkers";

const landmarksByMap = new WeakMap<MapboxMap, Record<string, Marker>>();

export function updateAtlasRegistryLandmarkLayer(map: MapboxMap, landmarks: MapSourceRecord[], visible: boolean) {
  let markers = landmarksByMap.get(map);
  if (!markers) { markers = {}; landmarksByMap.set(map, markers); }
  syncAtlasPinMarkers(map, markers, landmarks.map((source) => ({
    id: source.id, lat: source.latitude, lon: source.longitude, name: source.name,
    group: "LANDMARK", statusLine: [source.city, source.state].filter(Boolean).join(", "),
    actionUrl: source.source_url, actionLabel: "Open source", family: "mark" as const,
  })), { color: "#d7d7d7", shape: "diamond", sizeScale: 0.85 }, visible);
}
