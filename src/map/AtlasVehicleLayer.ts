import type { GeoJSONSource, Map } from "mapbox-gl";
import type { AtlasGpsPoint } from "./types";
import { incrementAtlasCounter } from "./AtlasDiagnostics";

const VEHICLE_SOURCE = "atlas-vehicle";
const VEHICLE_HEADING_SOURCE = "atlas-vehicle-heading";
const VEHICLE_ACCURACY_LAYER = "atlas-vehicle-accuracy";
const VEHICLE_PULSE_LAYER = "atlas-vehicle-pulse";
const VEHICLE_LAYER = "atlas-vehicle-marker";
const VEHICLE_HEADING_LAYER = "atlas-vehicle-heading";
const PULSE_CYCLE_MS = 1800;
const PULSE_MIN_RADIUS = 9;
const PULSE_MAX_RADIUS = 26;
const PULSE_START_OPACITY = 0.5;

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
        "circle-color": "rgba(255, 45, 53, 0.12)",
        "circle-stroke-color": "rgba(255, 45, 53, 0.35)",
        "circle-stroke-width": 1,
      },
    });
    incrementAtlasCounter("layerCreations");
  }

  // A rider on the accuracy circle: this is what actually pulses (see startAtlasVehiclePulse
  // below). Added here, before the heading/main-dot layers, so paint order stays fixed:
  // accuracy (bottom) -> pulse (animated) -> heading -> main dot (top, never obscured).
  if (!map.getLayer(VEHICLE_PULSE_LAYER)) {
    map.addLayer({
      id: VEHICLE_PULSE_LAYER,
      type: "circle",
      source: VEHICLE_SOURCE,
      paint: {
        "circle-radius": PULSE_MIN_RADIUS,
        "circle-color": "#ff2d35",
        "circle-opacity": PULSE_START_OPACITY,
        "circle-stroke-width": 0,
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
        "line-color": "#ff2d35",
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
        "circle-color": "#ff2d35",
        "circle-stroke-color": "#fff4f4",
        "circle-stroke-width": 2,
      },
    });
    incrementAtlasCounter("layerCreations");
  }
}

// Grows and fades on a loop so "my dot" reads at a glance without having to think about it, per
// the original ask. Safe to start before the vehicle layer itself exists (e.g. before a first GPS
// fix arrives) -- each tick just no-ops until updateAtlasVehicleLayer has created the pulse layer.
export function startAtlasVehiclePulse(map: Map): () => void {
  const startedAt = performance.now();
  let frameId = requestAnimationFrame(function tick(now) {
    if (map.getLayer(VEHICLE_PULSE_LAYER)) {
      const t = ((now - startedAt) % PULSE_CYCLE_MS) / PULSE_CYCLE_MS;
      try {
        map.setPaintProperty(VEHICLE_PULSE_LAYER, "circle-radius", PULSE_MIN_RADIUS + t * (PULSE_MAX_RADIUS - PULSE_MIN_RADIUS));
        map.setPaintProperty(VEHICLE_PULSE_LAYER, "circle-opacity", PULSE_START_OPACITY * (1 - t));
      } catch {
        // Style can be mid-reload for a frame or two; skip and try again next tick.
      }
    }
    frameId = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(frameId);
}
