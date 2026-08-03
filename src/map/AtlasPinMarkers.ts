import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, Marker, Popup } from "mapbox-gl";
import type { PinShape, PinStyle } from "../services/settings";

export interface PinPoint {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  updatedAtText?: string;
}

// Personalizable color + shape rules out plain Mapbox GL circle layers (GL circles are,
// definitionally, circles) without generating per-color/per-shape canvas icon images -- more
// complex than the alternative used here: mapboxgl.Marker with a styled DOM element, where each
// shape is a trivial CSS rule and color is just backgroundColor from the stored hex value.
const SHAPE_CLIP_PATH: Partial<Record<PinShape, string>> = {
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  triangle: "polygon(50% 0%, 100% 100%, 0% 100%)",
  star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};

function applyPinStyle(el: HTMLDivElement, style: PinStyle) {
  el.style.width = "20px";
  el.style.height = "20px";
  el.style.backgroundColor = style.color;
  el.style.border = "2px solid rgba(0, 0, 0, 0.65)";
  el.style.boxShadow = `0 0 0 2px rgba(0, 0, 0, 0.35), 0 0 10px 2px ${style.color}`;
  el.style.borderRadius = style.shape === "circle" ? "50%" : style.shape === "square" ? "2px" : "0";
  el.style.clipPath = SHAPE_CLIP_PATH[style.shape] ?? "";
  el.style.cursor = "pointer";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// One shared popup per map instance (not per layer) -- clicking a spotter pin closes any team pin
// popup already open and vice versa, matching how a single-selection map UI is expected to behave.
const activePopups = new WeakMap<MapboxMap, Popup>();

function showPinPopup(map: MapboxMap, point: PinPoint) {
  activePopups.get(map)?.remove();
  if (!point.name) return;
  const html = `<strong>${escapeHtml(point.name)}</strong><span>${point.updatedAtText ? `Last ping ${escapeHtml(point.updatedAtText)}` : "No recent ping data"}</span>`;
  const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, offset: 16, className: "atlas-pin-popup" })
    .setLngLat([point.lon, point.lat])
    .setHTML(html)
    .addTo(map);
  activePopups.set(map, popup);
}

// Latest point data per marker id, keyed off the caller-owned `markers` record so a click handler
// attached once at marker-creation time can still read fresh name/updatedAtText on every click
// instead of whatever was true the moment the marker was first created.
const latestPointsByMarkers = new WeakMap<Record<string, Marker>, Record<string, PinPoint>>();

// Adds/updates/removes mapboxgl.Marker instances to match `points`, keyed by id in the caller-owned
// `markers` record (a ref in AtlasMap.tsx) so existing markers are repositioned in place rather than
// torn down and recreated every call. Re-applies `style` to every marker on every sync -- cheap for
// the small pin counts here (a handful of teammates/spotters), and it's what makes a live color/shape
// change from Settings repaint the map immediately without any extra plumbing. Tapping a pin shows
// its name and last-ping age in a popup.
export function syncAtlasPinMarkers(map: MapboxMap, markers: Record<string, Marker>, points: PinPoint[], style: PinStyle, visible: boolean) {
  let latestPoints = latestPointsByMarkers.get(markers);
  if (!latestPoints) {
    latestPoints = {};
    latestPointsByMarkers.set(markers, latestPoints);
  }
  const seen = new Set<string>();
  if (visible) {
    for (const point of points) {
      seen.add(point.id);
      latestPoints[point.id] = point;
      let marker = markers[point.id];
      if (!marker) {
        const el = document.createElement("div");
        el.className = "atlas-pin-marker";
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          showPinPopup(map, latestPoints![point.id] ?? point);
        });
        marker = new mapboxgl.Marker({ element: el }).setLngLat([point.lon, point.lat]).addTo(map);
        markers[point.id] = marker;
      } else {
        marker.setLngLat([point.lon, point.lat]);
      }
      applyPinStyle(marker.getElement() as HTMLDivElement, style);
    }
  }
  for (const id of Object.keys(markers)) {
    if (!seen.has(id)) {
      markers[id].remove();
      delete markers[id];
      delete latestPoints[id];
    }
  }
}
