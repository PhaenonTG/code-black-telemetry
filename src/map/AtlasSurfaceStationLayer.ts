import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { SurfaceStationObservation } from "../services/mapLayerModels";
import type { PinStyle } from "../services/settings";
import type { MapCluster } from "./viewport";
import { syncAtlasPinMarkers, type PinPoint } from "./AtlasPinMarkers";

const stationMarkersByMap = new WeakMap<MapboxMap, Record<string, Marker>>();

const STATION_PIN_STYLE: PinStyle = {
  color: "#facc15",
  // Diamond made sense for a plain glyph pin; now that this pin reads its own dewpoint number
  // (see markerLabel below), the CSS pill override (.atlas-pin-marker--station) is what actually
  // controls the rendered shape -- circle is just the closest honest base for a text badge.
  shape: "circle",
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
    // Owner asked for the pin itself to read as the current dewpoint, not a generic station glyph --
    // clicking it still opens the full detailRows breakdown below (temp/wind/gust/visibility/etc.),
    // this just changes what's legible at a glance without tapping in.
    markerLabel: station.dewpointF !== null ? `${Math.round(station.dewpointF)}°` : undefined,
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
