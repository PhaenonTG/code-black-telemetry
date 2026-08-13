import mapboxgl from "mapbox-gl";
import type { GeoJSONSource, Map, Marker } from "mapbox-gl";
import type { AtlasGpsPoint } from "./types";
import type { VehicleMarkerShape, VehicleMarkerStyle } from "../services/settings";
import { incrementAtlasCounter } from "./AtlasDiagnostics";

const VEHICLE_SOURCE = "atlas-vehicle";
const VEHICLE_HEADING_SOURCE = "atlas-vehicle-heading";
const VEHICLE_ACCURACY_LAYER = "atlas-vehicle-accuracy";
const VEHICLE_HEADING_LAYER = "atlas-vehicle-heading";
const DEFAULT_VEHICLE_COLOR = "#ff2d35";

// The main dot moved from a GL circle layer to a mapboxgl.Marker (DOM element) so it can take an
// arbitrary color/shape, the same reasoning AtlasPinMarkers.ts documents for Team/Chaser pins: GL
// circles are definitionally circles, and generating per-color/per-shape canvas icons is a lot more
// machinery than a styled div. The accuracy ring, pulse, and heading line stay GL layers -- DOM
// markers render above the WebGL canvas by default, so the dot still reads as "on top" without
// needing the old fixed GL paint-order trick.
const VEHICLE_MARKER_SIZE_PX = 22;
const SHAPE_CLIP_PATH: Partial<Record<VehicleMarkerShape, string>> = {
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  triangle: "polygon(50% 0%, 100% 100%, 0% 100%)",
  star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};

function alphaColor(color: string, alpha: number) {
  const match = color.trim().match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return `rgba(255, 45, 53, ${alpha})`;
  const [, r, g, b] = match;
  return `rgba(${Number.parseInt(r, 16)}, ${Number.parseInt(g, 16)}, ${Number.parseInt(b, 16)}, ${alpha})`;
}

function applyVehicleMarkerStyle(el: HTMLDivElement, style: VehicleMarkerStyle) {
  const size = VEHICLE_MARKER_SIZE_PX * (style.sizeScale ?? 1);
  const core = el.querySelector<HTMLDivElement>(".atlas-vehicle-marker__core") ?? el;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.setProperty("--atlas-vehicle-color", style.color);
  el.style.setProperty("--atlas-vehicle-pulse-fill", alphaColor(style.color, 0.42));
  el.style.setProperty("--atlas-vehicle-pulse-glow", alphaColor(style.color, 0.68));
  el.style.setProperty("--atlas-vehicle-size", `${size}px`);
  el.style.cursor = "default";
  core.style.backgroundColor = style.color;
  core.style.borderRadius = style.shape === "circle" ? "50%" : style.shape === "square" ? "3px" : "0";
  core.style.clipPath = SHAPE_CLIP_PATH[style.shape] ?? "";
  core.style.border = "2px solid #fff4f4";
  core.style.boxShadow = `0 0 10px 2px ${style.color}`;
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

export function updateAtlasVehicleLayer(map: Map, gps: AtlasGpsPoint | null, style: VehicleMarkerStyle = { color: DEFAULT_VEHICLE_COLOR, shape: "circle", sizeScale: 1 }) {
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
  // accuracy ring/heading immediately, the same "just re-apply, it's cheap" approach
  // AtlasPinMarkers.ts uses for Team/Chaser pins.
  map.setPaintProperty(VEHICLE_ACCURACY_LAYER, "circle-color", style.color);
  map.setPaintProperty(VEHICLE_ACCURACY_LAYER, "circle-stroke-color", style.color);
  map.setPaintProperty(VEHICLE_HEADING_LAYER, "line-color", style.color);

  let marker = vehicleMarkers.get(map);
  if (!marker) {
    const el = document.createElement("div");
    el.className = "atlas-vehicle-marker";
    const core = document.createElement("div");
    core.className = "atlas-vehicle-marker__core";
    el.appendChild(core);
    marker = new mapboxgl.Marker({ element: el }).setLngLat([gps.lon, gps.lat]).addTo(map);
    vehicleMarkers.set(map, marker);
  } else {
    marker.setLngLat([gps.lon, gps.lat]);
  }
  applyVehicleMarkerStyle(marker.getElement() as HTMLDivElement, style);
}
