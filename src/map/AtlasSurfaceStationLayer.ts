import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { SurfaceStationObservation } from "../services/mapLayerModels";
import type { PinStyle } from "../services/settings";
import type { MapCluster } from "./viewport";
import { syncAtlasPinMarkers, type PinPoint } from "./AtlasPinMarkers";

const stationMarkersByMap = new WeakMap<MapboxMap, Record<string, Marker>>();

const STATION_PIN_STYLE: PinStyle = {
  color: "#facc15",
  shape: "diamond",
  sizeScale: 0.84,
};

function stationToPin(station: SurfaceStationObservation | MapCluster<SurfaceStationObservation>): PinPoint {
  if ("count" in station) {
    return {
      id: `station-${station.id}`,
      lat: station.lat,
      lon: station.lon,
      name: `${station.count} stations`,
      group: "Surface Obs",
      statusLine: "Clustered viewport objects",
      clusterCount: station.count,
      family: "station",
      stale: station.points.some((point) => point.stale),
    };
  }
  const parts: string[] = [];
  if (station.temperatureF !== null) parts.push(`${station.temperatureF}°`);
  if (station.dewpointF !== null) parts.push(`Dew ${station.dewpointF}°`);
  if (station.windSpeedMph !== null) parts.push(`${station.windSpeedMph} mph`);
  if (station.visibilityMiles != null) parts.push(`Vis ${station.visibilityMiles} mi`);
  return {
    id: `station-${station.id}`,
    lat: station.lat,
    lon: station.lon,
    name: station.id,
    statusLine: parts.join(" · ") || "No current reading",
    detailRows: [
      { label: "Temp", value: station.temperatureF !== null ? `${station.temperatureF}°` : "--" },
      { label: "Dewpoint", value: station.dewpointF !== null ? `${station.dewpointF}°` : "--" },
      { label: "Wind", value: station.windSpeedMph !== null ? `${station.windSpeedMph} mph` : "--" },
      ...(station.windGustMph != null ? [{ label: "Gust", value: `${station.windGustMph} mph` }] : []),
      ...(station.visibilityMiles != null ? [{ label: "Visibility", value: `${station.visibilityMiles} mi` }] : []),
      ...(station.precipitationType ? [{ label: "Precip", value: station.precipitationType }] : []),
      ...(station.roadway ? [{ label: "Road", value: station.roadway }] : []),
    ],
    family: "station",
    stale: station.stale,
  };
}

export function updateAtlasSurfaceStationLayer(map: MapboxMap, stations: Array<SurfaceStationObservation | MapCluster<SurfaceStationObservation>>, visible: boolean) {
  let markers = stationMarkersByMap.get(map);
  if (!markers) {
    markers = {};
    stationMarkersByMap.set(map, markers);
  }
  syncAtlasPinMarkers(map, markers, stations.map(stationToPin), STATION_PIN_STYLE, visible);
}
