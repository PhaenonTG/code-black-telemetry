import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { TrafficCamera } from "../services/mapLayerModels";
import type { PinStyle } from "../services/settings";
import type { MapCluster } from "./viewport";
import { syncAtlasPinMarkers, type PinPoint } from "./AtlasPinMarkers";

const cameraMarkersByMap = new WeakMap<MapboxMap, Record<string, Marker>>();

const CAMERA_PIN_STYLE: PinStyle = {
  color: "#38bdf8",
  shape: "circle",
  sizeScale: 0.84,
};

function ageLabel(timestamp: number | null) {
  if (!timestamp) return "Image age not reported";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `Updated ${hours}h ago`;
}

function cameraToPin(camera: TrafficCamera | MapCluster<TrafficCamera>): PinPoint {
  if ("count" in camera) {
    return {
      id: `camera-${camera.id}`,
      lat: camera.lat,
      lon: camera.lon,
      name: `${camera.count} public cameras`,
      group: "Traffic / Public Cameras",
      statusLine: "Clustered viewport objects",
      clusterCount: camera.count,
      family: "camera",
      stale: camera.points.some((point) => point.availability !== "available" || point.freshness === "stale"),
    };
  }
  const stale = camera.availability !== "available" || camera.freshness === "stale" || camera.freshness === "unavailable";
  // Deliberately minimal: name, one-line status, snapshot preview, VIEW CAMERA. Road/direction/
  // source/provider-link all duplicate what MapCameraViewer already shows in full once opened --
  // this in-map popup is a quick "what is this and is it worth opening," not a second copy of the
  // full detail view.
  return {
    id: `camera-${camera.id}`,
    lat: camera.lat,
    lon: camera.lon,
    name: camera.name,
    statusLine: camera.availability === "available" ? ageLabel(camera.lastUpdateAt) : camera.availability.toUpperCase(),
    imageUrl: camera.previewUrl ?? camera.thumbnailUrl,
    cameraData: camera,
    family: "camera",
    stale,
  };
}

export function updateAtlasTrafficCameraLayer(map: MapboxMap, cameras: Array<TrafficCamera | MapCluster<TrafficCamera>>, visible: boolean) {
  let markers = cameraMarkersByMap.get(map);
  if (!markers) {
    markers = {};
    cameraMarkersByMap.set(map, markers);
  }
  syncAtlasPinMarkers(map, markers, cameras.map(cameraToPin), CAMERA_PIN_STYLE, visible);
}
