import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, Marker, Popup } from "mapbox-gl";
import type { NearbyPlace } from "../services/nearby";

// Separate from AtlasPinMarkers.ts (spotter/team position pins) rather than extended to share it --
// that helper applies one PinStyle to every point in a call, but POIs need per-point styling
// (favorite brand vs. not, gas vs. food) and a different popup body (hours/distance, not a "last
// ping" age). Same overall shape (mapboxgl.Marker + DOM element, WeakMap-keyed latest-data cache for
// fresh-on-click popups, create/update/remove-by-id sync) since that pattern is already proven here.

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hoursLabel(place: NearbyPlace) {
  if (place.hoursStatus === "open") return "OPEN";
  if (place.hoursStatus === "closed") return "CLOSED";
  if (place.hoursStatus === "typical-open") return "TYPICALLY OPEN";
  return "HOURS UNKNOWN";
}

const activePopups = new WeakMap<MapboxMap, Popup>();

function showPoiPopup(map: MapboxMap, place: NearbyPlace) {
  activePopups.get(map)?.remove();
  const html = `<strong>${escapeHtml(place.name)}</strong><span>${place.distanceMiles.toFixed(1)} mi &middot; ${hoursLabel(place)}</span>`;
  const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, offset: 14, className: "atlas-pin-popup" })
    .setLngLat([place.lon, place.lat])
    .setHTML(html)
    .addTo(map);
  activePopups.set(map, popup);
}

function isFavorite(place: NearbyPlace, favoriteBrands: string[]) {
  if (favoriteBrands.length === 0) return false;
  const name = place.name.toLowerCase();
  return favoriteBrands.some((brand) => brand.trim() && name.includes(brand.trim().toLowerCase()));
}

function applyPoiStyle(el: HTMLDivElement, place: NearbyPlace, favorite: boolean) {
  const size = favorite ? 18 : 12;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.backgroundColor = favorite ? "#ffffff" : "#8b929e";
  el.style.border = "2px solid rgba(0, 0, 0, 0.65)";
  el.style.boxShadow = favorite
    ? "0 0 0 2px rgba(0, 0, 0, 0.35), 0 0 10px 2px rgba(255, 255, 255, 0.85)"
    : "0 0 0 1px rgba(0, 0, 0, 0.35)";
  // Gas reads as a small square (fuel-pump silhouette, loosely), food as a circle -- same
  // shape-as-category-signal idea as the existing watch/warning/MD layers using fill vs. dashed
  // outline to distinguish product types at a glance.
  el.style.borderRadius = place.category === "gas" ? "3px" : "50%";
  el.style.cursor = "pointer";
}

// Per-map marker registry, same WeakMap-keyed-by-instance pattern AtlasSpotterLayer.ts/
// AtlasTeamLayer.ts already use -- safe when more than one AtlasMap is mounted at once (Weather +
// Locate pages both render one).
const poiMarkers = new WeakMap<MapboxMap, Record<string, Marker>>();
const latestPlacesByMarkers = new WeakMap<Record<string, Marker>, Record<string, NearbyPlace>>();

export function updateAtlasPoiLayer(map: MapboxMap, places: NearbyPlace[], favoriteBrands: string[], visible: boolean) {
  let markers = poiMarkers.get(map);
  if (!markers) {
    markers = {};
    poiMarkers.set(map, markers);
  }
  let latest = latestPlacesByMarkers.get(markers);
  if (!latest) {
    latest = {};
    latestPlacesByMarkers.set(markers, latest);
  }
  const seen = new Set<string>();
  if (visible) {
    for (const place of places) {
      seen.add(place.id);
      latest[place.id] = place;
      let marker = markers[place.id];
      if (!marker) {
        const el = document.createElement("div");
        el.className = "atlas-poi-marker";
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          const current = latest![place.id];
          if (current) showPoiPopup(map, current);
        });
        marker = new mapboxgl.Marker({ element: el }).setLngLat([place.lon, place.lat]).addTo(map);
        markers[place.id] = marker;
      } else {
        marker.setLngLat([place.lon, place.lat]);
      }
      applyPoiStyle(marker.getElement() as HTMLDivElement, place, isFavorite(place, favoriteBrands));
    }
  }
  for (const id of Object.keys(markers)) {
    if (!seen.has(id)) {
      markers[id].remove();
      delete markers[id];
      delete latest[id];
    }
  }
}
