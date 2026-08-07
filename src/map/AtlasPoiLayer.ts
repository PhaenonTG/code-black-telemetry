import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, Marker, Popup } from "mapbox-gl";
import type { NearbyCategory, NearbyPlace } from "../services/nearby";
import type { CustomPoiPin } from "../services/settings";

// Separate from AtlasPinMarkers.ts (spotter/team position pins) rather than extended to share it --
// that helper applies one PinStyle to every point in a call, but POIs need per-point styling
// (which custom brand matched, the fixed ER look, or a "closest of category" pick) and a different
// popup body (hours/distance, not a "last ping" age). Same overall shape (mapboxgl.Marker + DOM
// element, WeakMap-keyed latest-data cache for fresh-on-click popups, create/update/remove-by-id
// sync) since that pattern is already proven here.

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

// Owner: "I don't want that to list every available option, I want the ability to change that
// myself" -- gas/food/hospital places from the broader list only render at all when they match a
// curated custom pin (by name substring, same matching approach teamRoster always used) or are the
// single closest-of-category pick already shown on the Nearby card; everything else in the raw
// Overpass feed is simply not shown here. Hospitals used to bypass this entirely and render every
// one in range -- owner: "Nearby layer on the dash map needs to only include what is listed on the
// nearby tab" (which only ever shows the one closest ER) -- so hospitals now go through the same
// best-pick gate as gas/lodging/food instead of a special always-on case.
function matchCustomPin(place: NearbyPlace, customPins: CustomPoiPin[]): CustomPoiPin | null {
  const name = place.name.toLowerCase();
  for (const pin of customPins) {
    const match = pin.matchText.trim().toLowerCase();
    if (match && name.includes(match)) return pin;
  }
  return null;
}

const ER_COLOR = "#ff2d35";
// Closest-of-category picks (gas/lodging/food) get their own fixed, un-configurable style -- these
// aren't curated by the owner the way custom pins are, they're just "whatever's actually nearest
// right now" mirroring the Nearby card's own best-pick tiles, so a single letter + a color per
// category is enough to tell them apart from custom brand pins at a glance. No blue (this app's
// palette rule); red is reserved for ER/vehicle/warnings.
const BEST_PICK_STYLE: Partial<Record<NearbyCategory, { color: string; label: string }>> = {
  gas: { color: "#ffbe3c", label: "G" },
  lodging: { color: "#b26bff", label: "H" },
  food: { color: "#3ddc70", label: "F" },
};

function applyLabeledPinStyle(el: HTMLDivElement, color: string, label: string) {
  const size = 22;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.backgroundImage = "";
  el.style.backgroundColor = color;
  el.style.border = "2px solid rgba(0, 0, 0, 0.65)";
  el.style.borderRadius = "4px";
  el.style.boxShadow = `0 0 0 2px rgba(0, 0, 0, 0.35), 0 0 8px 2px ${color}`;
  el.style.display = "grid";
  el.style.placeItems = "center";
  el.style.color = "#000";
  el.style.font = "800 10px/1 'JetBrains Mono', monospace";
  el.textContent = label;
  el.style.cursor = "pointer";
}

function applyPoiStyle(el: HTMLDivElement, place: NearbyPlace, customPin: CustomPoiPin | null, isBestPick: boolean) {
  if (place.category === "hospital") {
    applyLabeledPinStyle(el, ER_COLOR, "ER");
    return;
  }

  if (!customPin && isBestPick) {
    const style = BEST_PICK_STYLE[place.category];
    if (style) {
      applyLabeledPinStyle(el, style.color, style.label);
      return;
    }
  }

  const size = 22;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.display = "block";
  el.textContent = "";
  el.style.font = "";
  el.style.color = "";
  if (customPin?.imageDataUrl) {
    el.style.backgroundImage = `url(${customPin.imageDataUrl})`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.backgroundColor = "";
    el.style.borderRadius = "6px";
  } else {
    el.style.backgroundImage = "";
    el.style.backgroundColor = customPin?.color ?? "#ffffff";
    el.style.borderRadius = "50%";
  }
  el.style.border = "2px solid rgba(0, 0, 0, 0.65)";
  el.style.boxShadow = "0 0 0 2px rgba(0, 0, 0, 0.35), 0 0 8px 2px rgba(255, 255, 255, 0.5)";
  el.style.cursor = "pointer";
}

// Per-map marker registry, same WeakMap-keyed-by-instance pattern AtlasSpotterLayer.ts/
// AtlasTeamLayer.ts already use -- safe when more than one AtlasMap is mounted at once (Weather +
// Locate pages both render one).
const poiMarkers = new WeakMap<MapboxMap, Record<string, Marker>>();
const latestPlacesByMarkers = new WeakMap<Record<string, Marker>, Record<string, NearbyPlace>>();

export function updateAtlasPoiLayer(
  map: MapboxMap,
  places: NearbyPlace[],
  nearbyBest: Partial<Record<NearbyCategory, NearbyPlace>>,
  customPins: CustomPoiPin[],
  visible: boolean,
) {
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
    // Merge the general POI list with the Nearby card's own closest-per-category picks -- a best
    // pick that also happens to be in the general list (common for gas/food, since both come from
    // the same Overpass data) shouldn't render as two overlapping markers. Best-pick entries win
    // the merge (they carry the "closest of category" styling) when the same id shows up in both.
    const merged = new Map<string, NearbyPlace>();
    for (const place of places) merged.set(place.id, place);
    for (const place of Object.values(nearbyBest)) {
      if (place) merged.set(place.id, place);
    }
    const bestPickIds = new Set(Object.values(nearbyBest).filter(Boolean).map((place) => place!.id));

    for (const place of merged.values()) {
      const isBestPick = bestPickIds.has(place.id);
      const customPin = matchCustomPin(place, customPins);
      if (!isBestPick && !customPin) continue;
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
      applyPoiStyle(marker.getElement() as HTMLDivElement, place, customPin, isBestPick);
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
