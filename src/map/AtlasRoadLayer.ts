import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { RoadConditionEvent } from "../services/mapLayerModels";
import type { PinStyle } from "../services/settings";
import type { MapCluster } from "./viewport";
import { syncAtlasPinMarkers, type PinPoint } from "./AtlasPinMarkers";

const roadMarkersByMap = new WeakMap<MapboxMap, Record<string, Marker>>();

const ROAD_PIN_STYLE: PinStyle = {
  color: "#ff7e30",
  shape: "diamond",
  sizeScale: 0.92,
};

function ageLabel(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `Updated ${hours}h ago`;
}

function kindLabel(kind: RoadConditionEvent["kind"]) {
  return kind.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function roadEventToPin(event: RoadConditionEvent | MapCluster<RoadConditionEvent>): PinPoint {
  if ("count" in event) {
    return {
      id: `road-${event.id}`,
      lat: event.lat,
      lon: event.lon,
      name: `${event.count} road conditions`,
      group: "Road Conditions",
      statusLine: "Clustered viewport objects",
      clusterCount: event.count,
      family: "road",
      stale: event.points.some((point) => point.stale),
    };
  }
  return {
    id: `road-${event.id}`,
    lat: event.lat,
    lon: event.lon,
    name: event.title,
    group: event.provider.displayLabel,
    statusLine: `${kindLabel(event.kind)} - ${event.severity.toUpperCase()} - ${ageLabel(event.updatedAt)}`,
    detailRows: [
      { label: "Road", value: event.roadway ?? "Not reported" },
      { label: "Status", value: event.status || event.closureState },
      { label: "Direction", value: event.direction },
      { label: "Details", value: event.description || "No description reported." },
      { label: "Source", value: event.provider.sourceName },
    ],
    actionUrl: event.sourceUrl,
    actionLabel: "Open provider",
    family: "road",
    stale: event.stale,
  };
}

export function updateAtlasRoadConditionLayer(map: MapboxMap, events: Array<RoadConditionEvent | MapCluster<RoadConditionEvent>>, visible: boolean) {
  let markers = roadMarkersByMap.get(map);
  if (!markers) {
    markers = {};
    roadMarkersByMap.set(map, markers);
  }
  syncAtlasPinMarkers(map, markers, events.map(roadEventToPin), ROAD_PIN_STYLE, visible);
}
