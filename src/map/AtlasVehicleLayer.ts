import type { GeoJSONSource, Map } from "mapbox-gl";
import type { AtlasGpsPoint } from "./types";
import { incrementAtlasCounter } from "./AtlasDiagnostics";

const VEHICLE_SOURCE = "atlas-vehicle";
const VEHICLE_HEADING_SOURCE = "atlas-vehicle-heading";
const VEHICLE_ACCURACY_LAYER = "atlas-vehicle-accuracy";
const VEHICLE_LAYER = "atlas-vehicle-marker";
const VEHICLE_HEADING_LAYER = "atlas-vehicle-heading";

function destinationPoint(lat: number, lon: number, bearingDeg: number, miles: number) {
  const radiusMiles = 3958.7613;
  const distance = miles / radiusMiles;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance) + Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1), Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2));
  return [((((lon2 * 180) / Math.PI) + 540) % 360) - 180, (lat2 * 180) / Math.PI] as [number, number];
}

export function updateAtlasVehicleLayer(map: Map, gps: AtlasGpsPoint | null) {
  if (!gps) return;
  const point = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { accuracyM: gps.accuracyM ?? 0 },
      geometry: { type: "Point", coordinates: [gps.lon, gps.lat] },
    }],
  };
  const headingEnd = gps.headingDeg == null ? [gps.lon, gps.lat] : destinationPoint(gps.lat, gps.lon, gps.headingDeg, 1.8);
  const heading = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[gps.lon, gps.lat], headingEnd] },
    }],
  };

  const vehicleSource = map.getSource(VEHICLE_SOURCE) as GeoJSONSource | undefined;
  if (vehicleSource) {
    vehicleSource.setData(point as never);
    incrementAtlasCounter("sourceUpdates");
  } else {
    map.addSource(VEHICLE_SOURCE, { type: "geojson", data: point as never });
    incrementAtlasCounter("sourceCreations");
  }

  const headingSource = map.getSource(VEHICLE_HEADING_SOURCE) as GeoJSONSource | undefined;
  if (headingSource) {
    headingSource.setData(heading as never);
    incrementAtlasCounter("sourceUpdates");
  } else {
    map.addSource(VEHICLE_HEADING_SOURCE, { type: "geojson", data: heading as never });
    incrementAtlasCounter("sourceCreations");
  }

  if (!map.getLayer(VEHICLE_ACCURACY_LAYER)) {
    map.addLayer({
      id: VEHICLE_ACCURACY_LAYER,
      type: "circle",
      source: VEHICLE_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 8, 11, 32],
        "circle-color": "rgba(20, 167, 255, 0.12)",
        "circle-stroke-color": "rgba(20, 167, 255, 0.35)",
        "circle-stroke-width": 1,
      },
    });
    incrementAtlasCounter("layerCreations");
  }

  if (!map.getLayer(VEHICLE_HEADING_LAYER)) {
    map.addLayer({
      id: VEHICLE_HEADING_LAYER,
      type: "line",
      source: VEHICLE_HEADING_SOURCE,
      paint: {
        "line-color": "#14a7ff",
        "line-width": 4,
        "line-blur": 1,
        "line-opacity": 0.9,
      },
    });
    incrementAtlasCounter("layerCreations");
  }

  if (!map.getLayer(VEHICLE_LAYER)) {
    map.addLayer({
      id: VEHICLE_LAYER,
      type: "circle",
      source: VEHICLE_SOURCE,
      paint: {
        "circle-radius": 9,
        "circle-color": "#14a7ff",
        "circle-stroke-color": "#e9fbff",
        "circle-stroke-width": 2,
      },
    });
    incrementAtlasCounter("layerCreations");
  }
}
