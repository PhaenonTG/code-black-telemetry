import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { TrafficCamera } from "../services/mapLayerModels";
import type { PinStyle } from "../services/settings";
import type { MapCluster } from "./viewport";
import { syncAtlasPinMarkers, type PinPoint } from "./AtlasPinMarkers";

const cameraMarkersByMap = new WeakMap<MapboxMap, Record<string, Marker>>();

const CAMERA_PIN_STYLE: PinStyle = {
  color: "#b26bff",
  shape: "square",
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
  return {
    id: `camera-${camera.id}`,
    lat: camera.lat,
    lon: camera.lon,
    name: camera.name,
    group: camera.provider.displayLabel,
    statusLine: `${camera.availability.toUpperCase()} - ${ageLabel(camera.lastUpdateAt)}`,
    detailRows: [
      { label: "Road", value: camera.roadway ?? "Not reported" },
      { label: "View", value: camera.direction ?? "Not reported" },
      { label: "State", value: camera.availability },
      { label: "Source", value: camera.attribution },
    ],
    imageUrl: camera.previewUrl ?? camera.thumbnailUrl,
    actionUrl: camera.streamUrl ?? camera.sourceUrl,
    actionLabel: camera.streamUrl ? "Open stream" : "Open provider",
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
