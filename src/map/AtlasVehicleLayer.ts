import mapboxgl from "mapbox-gl";
import type { GeoJSONSource, Map, Marker } from "mapbox-gl";
import type { AtlasGpsPoint } from "./types";
import type { VehicleMarkerShape, VehicleMarkerStyle } from "../services/settings";
import { incrementAtlasCounter } from "./AtlasDiagnostics";

const VEHICLE_SOURCE = "atlas-vehicle";
const VEHICLE_HEADING_SOURCE = "atlas-vehicle-heading";
const VEHICLE_ACCURACY_LAYER = "atlas-vehicle-accuracy";
const VEHICLE_PULSE_LAYER = "atlas-vehicle-pulse";
const VEHICLE_HEADING_LAYER = "atlas-vehicle-heading";
const PULSE_CYCLE_MS = 1800;
const PULSE_MIN_RADIUS = 9;
const PULSE_MAX_RADIUS = 26;
const PULSE_START_OPACITY = 0.5;
const DEFAULT_VEHICLE_COLOR = "#ff2d35";

// The main dot moved from a GL circle layer to a mapboxgl.Marker (DOM element) so it can take an
// arbitrary color/shape/uploaded-image, the same reasoning AtlasPinMarkers.ts documents for Team/
// Chaser pins: GL circles are definitionally circles, and generating per-color/per-shape/per-image
// canvas icons is a lot more machinery than a styled div. The accuracy ring, pulse, and heading line
// stay GL layers -- DOM markers render above the WebGL canvas by default, so the dot still reads as
// "on top" without needing the old fixed GL paint-order trick.
const VEHICLE_MARKER_SIZE_PX = 22;
const SHAPE_CLIP_PATH: Partial<Record<VehicleMarkerShape, string>> = {
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  triangle: "polygon(50% 0%, 100% 100%, 0% 100%)",
  star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};

function applyVehicleMarkerStyle(el: HTMLDivElement, style: VehicleMarkerStyle) {
  el.style.width = `${VEHICLE_MARKER_SIZE_PX}px`;
  el.style.height = `${VEHICLE_MARKER_SIZE_PX}px`;
  el.style.cursor = "default";
  if (style.shape === "custom" && style.imageDataUrl) {
    el.style.backgroundImage = `url(${style.imageDataUrl})`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.backgroundColor = "";
    el.style.borderRadius = "6px";
    el.style.clipPath = "";
  } else {
    el.style.backgroundImage = "";
    el.style.backgroundColor = style.color;
    el.style.borderRadius = style.shape === "circle" ? "50%" : style.shape === "square" ? "3px" : "0";
    el.style.clipPath = SHAPE_CLIP_PATH[style.shape] ?? "";
  }
  el.style.border = "2px solid #fff4f4";
  el.style.boxShadow = `0 0 10px 2px ${style.color}`;
}

const vehicleMarkers = new WeakMap<Map, Marker>();

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

export function updateAtlasVehicleLayer(map: Map, gps: AtlasGpsPoint | null, style: VehicleMarkerStyle = { color: DEFAULT_VEHICLE_COLOR, shape: "circle" }) {
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
        // Color and alpha kept as separate paint props (rather than baked into one rgba string)
        // so the color can be updated live from the vehicle marker style without string-hacking.
        "circle-color": DEFAULT_VEHICLE_COLOR,
        "circle-opacity": 0.12,
        "circle-stroke-color": DEFAULT_VEHICLE_COLOR,
        "circle-stroke-opacity": 0.35,
        "circle-stroke-width": 1,
      },
    });
    incrementAtlasCounter("layerCreations");
  }

  // A rider on the accuracy circle: this is what actually pulses (see startAtlasVehiclePulse
  // below). Added here, before the heading layer, so paint order stays fixed: accuracy (bottom) ->
  // pulse (animated) -> heading. The main dot itself is a DOM marker (see applyVehicleMarkerStyle
  // above) and always renders above all of this since DOM markers sit above the WebGL canvas.
  if (!map.getLayer(VEHICLE_PULSE_LAYER)) {
    map.addLayer({
      id: VEHICLE_PULSE_LAYER,
      type: "circle",
      source: VEHICLE_SOURCE,
      paint: {
        "circle-radius": PULSE_MIN_RADIUS,
        "circle-color": DEFAULT_VEHICLE_COLOR,
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
        "line-color": DEFAULT_VEHICLE_COLOR,
        "line-width": 4,
        "line-blur": 1,
        "line-opacity": 0.9,
      },
    });
    incrementAtlasCounter("layerCreations");
  }

  // Re-applied every call (cheap -- one vehicle) so a live color change from Settings repaints the
  // accuracy ring/pulse/heading immediately, the same "just re-apply, it's cheap" approach
  // AtlasPinMarkers.ts uses for Team/Chaser pins.
  map.setPaintProperty(VEHICLE_ACCURACY_LAYER, "circle-color", style.color);
  map.setPaintProperty(VEHICLE_ACCURACY_LAYER, "circle-stroke-color", style.color);
  map.setPaintProperty(VEHICLE_PULSE_LAYER, "circle-color", style.color);
  map.setPaintProperty(VEHICLE_HEADING_LAYER, "line-color", style.color);

  let marker = vehicleMarkers.get(map);
  if (!marker) {
    const el = document.createElement("div");
    el.className = "atlas-vehicle-marker";
    marker = new mapboxgl.Marker({ element: el }).setLngLat([gps.lon, gps.lat]).addTo(map);
    vehicleMarkers.set(map, marker);
  } else {
    marker.setLngLat([gps.lon, gps.lat]);
  }
  applyVehicleMarkerStyle(marker.getElement() as HTMLDivElement, style);
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
