import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, Marker, Popup } from "mapbox-gl";
import type { PinShape, PinStyle } from "../services/settings";
import type { RoadConditionEvent, TrafficCamera } from "../services/mapLayerModels";
import { spotterAgeText } from "../services/spotters";

export interface PinPoint {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  updatedAtText?: string;
  group?: string;
  phone?: string;
  email?: string;
  statusLine?: string;
  detailRows?: Array<{ label: string; value: string }>;
  imageUrl?: string | null;
  actionUrl?: string | null;
  actionLabel?: string;
  cameraData?: TrafficCamera | null;
  roadData?: RoadConditionEvent | null;
  clusterCount?: number;
  family?: "team" | "chaser" | "report" | "probe" | "road" | "camera" | "mark";
  stale?: boolean;
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

// Nationwide zoom-out (checking the whole country at a glance) used to render every pin at the same
// 20px size as a close-in chase view, which -- combined with hundreds of active nationwide spotters
// -- turned into a wall of solid dots. Pins now shrink continuously with zoom: full size at the
// zoom level you'd actually be chasing at, down to a small dot for a nationwide overview, with the
// border/glow scaled down proportionally so they don't dominate the shrunken dot.
const MIN_PIN_SIZE_PX = 7;
const MAX_PIN_SIZE_PX = 20;
const ZOOM_AT_MIN_SIZE = 3; // world/nationwide overview
const ZOOM_AT_MAX_SIZE = 9; // local chase-range view

function pinSizeForZoom(zoom: number, sizeScale: number) {
  const t = (zoom - ZOOM_AT_MIN_SIZE) / (ZOOM_AT_MAX_SIZE - ZOOM_AT_MIN_SIZE);
  const clamped = Math.min(1, Math.max(0, t));
  return (MIN_PIN_SIZE_PX + clamped * (MAX_PIN_SIZE_PX - MIN_PIN_SIZE_PX)) * sizeScale;
}

function applyPinStyle(el: HTMLDivElement, style: PinStyle, zoom: number) {
  const size = pinSizeForZoom(zoom, style.sizeScale ?? 1);
  const borderWidth = Math.max(1, size / 10);
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.backgroundColor = style.color;
  el.style.border = `${borderWidth}px solid rgba(0, 0, 0, 0.65)`;
  // Flat dot, no colored glow halo -- the earlier `0 0 <blur> <color>` shadow was the "glowing
  // square" look the owner didn't want. Just enough neutral drop shadow to read against variable
  // map/radar backgrounds, same as any ordinary map pin.
  el.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.6)";
  el.style.borderRadius = style.shape === "circle" ? "50%" : style.shape === "square" ? "2px" : "0";
  el.style.clipPath = SHAPE_CLIP_PATH[style.shape] ?? "";
  el.style.cursor = "pointer";
}

function applyMarkerClasses(el: HTMLDivElement, point: PinPoint) {
  const family = point.family ?? "chaser";
  el.className = [
    "atlas-pin-marker",
    `atlas-pin-marker--${family}`,
    point.clusterCount && point.clusterCount > 1 ? "atlas-pin-marker--cluster" : "",
    point.stale ? "atlas-pin-marker--stale" : "",
  ].filter(Boolean).join(" ");
}

// Same glyph paths as LayerGlyph.tsx (the Layers popover's icon set) so a pin on the map and its
// row in the Layers list read as the same thing at a glance, rather than inventing a second icon
// language just for pins. "mark" (manual user-dropped pins) intentionally has no glyph -- a plain
// dot is the correct "you put this here yourself" affordance, not a category to illustrate.
const FAMILY_ICON_PATHS: Partial<Record<NonNullable<PinPoint["family"]>, string>> = {
  camera: `<path d="M4 8h4l2-3h4l2 3h4v11H4z" /><circle cx="12" cy="13" r="3" />`,
  road: `<path d="M8 21 11 3M16 21 13 3M5 14h14M6 8h12" />`,
  team: `<path d="M12 4 5 20h14L12 4Z" /><circle cx="12" cy="13" r="2" />`,
  chaser: `<circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M4 20c1-4 7-4 8 0M12 20c1-4 7-4 8 0" />`,
  report: `<circle cx="12" cy="12" r="3" /><path d="M4 12h5M15 12h5M12 4v5M12 15v5" />`,
  probe: `<path d="M12 3v11" /><circle cx="12" cy="17" r="4" /><path d="M8 21h8" />`,
};

function applyClusterLabel(el: HTMLDivElement, count: number | undefined, family: string) {
  if (count && count > 1) {
    el.textContent = String(count);
  } else {
    const iconPath = FAMILY_ICON_PATHS[family as NonNullable<PinPoint["family"]>];
    el.textContent = "";
    el.innerHTML = iconPath ? `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPath}</svg>` : "";
  }
  el.setAttribute("aria-label", count && count > 1 ? `${count} ${family} map objects` : `${family} map object`);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safePopupUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return escapeHtml(url.toString());
  } catch {
    return "";
  }
}

// One shared popup per map instance (not per layer) -- clicking a spotter pin closes any team pin
// popup already open and vice versa, matching how a single-selection map UI is expected to behave.
const activePopups = new WeakMap<MapboxMap, Popup>();

// Mapbox's own anchor auto-detection ("auto", the default when anchor isn't specified) picks a
// corner based on the marker's position relative to the *map container*, then repositions the
// popup on every subsequent render frame to keep tracking that corner -- so a one-time post-render
// correction of the element's own transform gets silently overwritten within a frame or two (this
// map re-renders continuously for the mosaic/pulse animations). The fix instead has to work with
// Mapbox's own per-frame positioning: pick a fixed anchor up front (whichever side of the marker
// actually has more room in the map's on-screen width) and size the popup to what that side can
// actually hold, rather than assuming a fixed width always fits. On phone-width map cards
// (measured as narrow as 312px, not the full device width) a fixed ~240px popup has no anchor that
// avoids overflow for a marker in the middle third of the card -- whichever side has more room
// still needs the popup sized to fit it, not just aimed at it.
const ATLAS_PIN_POPUP_MAX_WIDTH_PX = 240;
const ATLAS_PIN_POPUP_MIN_WIDTH_PX = 160;
const ATLAS_PIN_POPUP_EDGE_MARGIN_PX = 16;

function pinPopupPlacementFor(map: MapboxMap, lon: number, lat: number): { anchor: "bottom" | "bottom-left" | "bottom-right"; maxWidthPx: number } {
  const point = map.project([lon, lat]);
  const containerWidth = map.getContainer().clientWidth;
  const roomLeft = point.x - ATLAS_PIN_POPUP_EDGE_MARGIN_PX;
  const roomRight = containerWidth - point.x - ATLAS_PIN_POPUP_EDGE_MARGIN_PX;
  const roomCentered = Math.min(point.x, containerWidth - point.x) * 2 - ATLAS_PIN_POPUP_EDGE_MARGIN_PX * 2;
  if (roomCentered >= ATLAS_PIN_POPUP_MAX_WIDTH_PX) return { anchor: "bottom", maxWidthPx: ATLAS_PIN_POPUP_MAX_WIDTH_PX };
  // Whichever side has more room, even if neither reaches the preferred width -- the popup is then
  // sized to what that side can actually hold (floored so it never renders unreadably narrow).
  const anchor = roomRight >= roomLeft ? "bottom-left" : "bottom-right";
  const room = Math.max(roomLeft, roomRight);
  return { anchor, maxWidthPx: Math.max(ATLAS_PIN_POPUP_MIN_WIDTH_PX, Math.min(ATLAS_PIN_POPUP_MAX_WIDTH_PX, room)) };
}

function showPinPopup(map: MapboxMap, point: PinPoint) {
  activePopups.get(map)?.remove();
  if (!point.name) return;
  // Computed fresh at click time (not whenever the marker last synced) so it's accurate to the
  // moment the popup is actually being read, not stale by however long since the last data poll.
  const age = point.updatedAtText ? spotterAgeText(point.updatedAtText) : "";
  const pingLine = point.statusLine
    ? `<span>${escapeHtml(point.statusLine)}</span>`
    : `<span>${age ? `Last ping: ${escapeHtml(age)}` : "No recent ping data"}</span>`;
  // group/phone/email are only ever set for Team pins (see AtlasTeamLayer.ts) -- Chaser pins never
  // carry contact info the owner didn't enter themselves, so these lines simply don't render there.
  const groupLine = point.group ? `<em>${escapeHtml(point.group)}</em>` : "";
  const phoneLine = point.phone ? `<span>${escapeHtml(point.phone)}</span>` : "";
  const emailLine = point.email ? `<span>${escapeHtml(point.email)}</span>` : "";
  const details = point.detailRows?.length
    ? `<div class="atlas-pin-popup__details">${point.detailRows.map((row) => `<span><b>${escapeHtml(row.label)}</b>${escapeHtml(row.value)}</span>`).join("")}</div>`
    : "";
  const imageUrl = safePopupUrl(point.imageUrl);
  const image = imageUrl
    ? `<div class="atlas-pin-popup__media" data-camera-media-state="loading"><span>LOADING CAMERA IMAGE</span><img class="atlas-pin-popup__image" src="${imageUrl}" alt="" loading="lazy" referrerpolicy="no-referrer" /></div>`
    : "";
  const actionUrl = safePopupUrl(point.actionUrl);
  const cameraAction = point.family === "camera" && point.cameraData
    ? `<button type="button" class="atlas-pin-popup__action atlas-pin-popup__camera-open">VIEW CAMERA</button>`
    : "";
  const roadAction = point.family === "road" && point.roadData
    ? `<button type="button" class="atlas-pin-popup__action atlas-pin-popup__road-open">VIEW DETAILS</button>`
    : "";
  const action = actionUrl ? `<a class="atlas-pin-popup__action" href="${actionUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(point.actionLabel ?? "Open source")}</a>` : "";
  const html = `<strong>${escapeHtml(point.name)}</strong>${groupLine}${pingLine}${details}${image}${phoneLine}${emailLine}${cameraAction}${roadAction}${action}`;
  const placement = pinPopupPlacementFor(map, point.lon, point.lat);
  const popup = new mapboxgl.Popup({
    closeButton: true,
    closeOnClick: false,
    offset: 16,
    className: "atlas-pin-popup",
    anchor: placement.anchor,
    maxWidth: `${placement.maxWidthPx}px`,
  })
    .setLngLat([point.lon, point.lat])
    .setHTML(html)
    .addTo(map);
  const cameraOpen = popup.getElement()?.querySelector<HTMLButtonElement>(".atlas-pin-popup__camera-open");
  if (cameraOpen && point.cameraData) {
    cameraOpen.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent<TrafficCamera>("codeblack:map-camera-open", { detail: point.cameraData! }));
    });
  }
  const roadOpen = popup.getElement()?.querySelector<HTMLButtonElement>(".atlas-pin-popup__road-open");
  if (roadOpen && point.roadData) {
    roadOpen.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent<RoadConditionEvent>("codeblack:map-road-open", { detail: point.roadData! }));
    });
  }
  const media = popup.getElement()?.querySelector<HTMLElement>(".atlas-pin-popup__media");
  const mediaStatus = media?.querySelector<HTMLElement>("span");
  const mediaImage = media?.querySelector<HTMLImageElement>("img");
  if (media && mediaStatus && mediaImage) {
    mediaImage.addEventListener("load", () => {
      media.dataset.cameraMediaState = "available";
      mediaStatus.textContent = "SNAPSHOT AVAILABLE";
    }, { once: true });
    mediaImage.addEventListener("error", () => {
      media.dataset.cameraMediaState = "blocked";
      mediaStatus.textContent = "MEDIA BLOCKED OR UNAVAILABLE";
    }, { once: true });
  }
  activePopups.set(map, popup);
  ensurePopupVisible(map, popup);
}

// A popup anchored near the container's top edge (a common case once the map's own header/status
// strip eats vertical space) can still render partly off-screen even with pinPopupPlacementFor's
// horizontal-fit logic, since that only sizes width, not vertical position. Measures the actual
// rendered popup after layout and, if any edge clips the container, pans by exactly that many
// screen pixels -- letting Mapbox handle the lng/lat math rather than reprojecting by hand.
function ensurePopupVisible(map: MapboxMap, popup: Popup) {
  requestAnimationFrame(() => {
    if (activePopups.get(map) !== popup) return;
    const el = popup.getElement();
    if (!el) return;
    const containerRect = map.getContainer().getBoundingClientRect();
    const popupRect = el.getBoundingClientRect();
    const margin = 12;
    let dx = 0;
    let dy = 0;
    if (popupRect.left < containerRect.left + margin) dx = popupRect.left - (containerRect.left + margin);
    else if (popupRect.right > containerRect.right - margin) dx = popupRect.right - (containerRect.right - margin);
    if (popupRect.top < containerRect.top + margin) dy = popupRect.top - (containerRect.top + margin);
    else if (popupRect.bottom > containerRect.bottom - margin) dy = popupRect.bottom - (containerRect.bottom - margin);
    if (dx === 0 && dy === 0) return;
    map.panBy([dx, dy], { duration: 300, easing: (t) => 1 - (1 - t) ** 3 });
  });
}

// Latest point data per marker id, keyed off the caller-owned `markers` record so a click handler
// attached once at marker-creation time can still read fresh name/updatedAtText on every click
// instead of whatever was true the moment the marker was first created.
const latestPointsByMarkers = new WeakMap<Record<string, Marker>, Record<string, PinPoint>>();
// Zoom changes fire continuously during a pinch/drag gesture -- resizing markers is handled by a
// single listener per markers record (attached once, guarded by this WeakSet) rather than routed
// through React state, so a zoom gesture never triggers a component re-render just to resize dots.
const latestStyleByMarkers = new WeakMap<Record<string, Marker>, PinStyle>();
const zoomListenerAttached = new WeakSet<Record<string, Marker>>();

// Adds/updates/removes mapboxgl.Marker instances to match `points`, keyed by id in the caller-owned
// `markers` record (a ref in AtlasMap.tsx) so existing markers are repositioned in place rather than
// torn down and recreated every call. Re-applies `style` to every marker on every sync -- cheap for
// the small pin counts here (a handful of teammates/spotters), and it's what makes a live color/shape
// change from Settings repaint the map immediately without any extra plumbing. Tapping a pin shows
// its name and last-ping age in a popup.
export function syncAtlasPinMarkers(map: MapboxMap, markers: Record<string, Marker>, points: PinPoint[], style: PinStyle, visible: boolean) {
  latestStyleByMarkers.set(markers, style);
  let latestPoints = latestPointsByMarkers.get(markers);
  if (!latestPoints) {
    latestPoints = {};
    latestPointsByMarkers.set(markers, latestPoints);
  }
  const zoom = map.getZoom();
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
      const element = marker.getElement() as HTMLDivElement;
      applyMarkerClasses(element, point);
      applyPinStyle(element, style, zoom);
      applyClusterLabel(element, point.clusterCount, point.family ?? "chaser");
    }
  }
  for (const id of Object.keys(markers)) {
    if (!seen.has(id)) {
      markers[id].remove();
      delete markers[id];
      delete latestPoints[id];
    }
  }

  if (!zoomListenerAttached.has(markers)) {
    zoomListenerAttached.add(markers);
    map.on("zoom", () => {
      const currentStyle = latestStyleByMarkers.get(markers);
      if (!currentStyle) return;
      const currentZoom = map.getZoom();
      for (const id of Object.keys(markers)) {
        const element = markers[id].getElement() as HTMLDivElement;
        const point = latestPointsByMarkers.get(markers)?.[id];
        if (point) applyMarkerClasses(element, point);
        applyPinStyle(element, currentStyle, currentZoom);
        applyClusterLabel(element, point?.clusterCount, point?.family ?? "chaser");
      }
    });
  }
}
