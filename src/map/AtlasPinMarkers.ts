import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { PinShape, PinStyle } from "../services/settings";

export interface PinPoint {
  id: string;
  lat: number;
  lon: number;
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
}

// Adds/updates/removes mapboxgl.Marker instances to match `points`, keyed by id in the caller-owned
// `markers` record (a ref in AtlasMap.tsx) so existing markers are repositioned in place rather than
// torn down and recreated every call. Re-applies `style` to every marker on every sync -- cheap for
// the small pin counts here (a handful of teammates/spotters), and it's what makes a live color/shape
// change from Settings repaint the map immediately without any extra plumbing.
export function syncAtlasPinMarkers(map: MapboxMap, markers: Record<string, Marker>, points: PinPoint[], style: PinStyle, visible: boolean) {
  const seen = new Set<string>();
  if (visible) {
    for (const point of points) {
      seen.add(point.id);
      let marker = markers[point.id];
      if (!marker) {
        const el = document.createElement("div");
        el.className = "atlas-pin-marker";
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
    }
  }
}
