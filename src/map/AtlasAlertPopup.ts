import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, Popup } from "mapbox-gl";
import { requestAlertFocus } from "../services/mapFocusAlert";

export interface AlertPopupInfo {
  id: string;
  title: string;
  headline: string;
  expires: string;
}

function timeRemainingText(expiresIso: string): string {
  if (!expiresIso) return "";
  const expiresAt = new Date(expiresIso).getTime();
  if (!Number.isFinite(expiresAt)) return "";
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "Expired";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `Expires in ${minutes} min`;
  return `Expires in ${(minutes / 60).toFixed(1)} hrs`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// One shared popup per map, same pattern as AtlasPinMarkers.ts -- clicking a different feature
// (or a different layer entirely, watches vs warnings) replaces whatever's already open.
const activePopups = new WeakMap<MapboxMap, Popup>();

// Same click -> minimal popup -> "View Details" opens the full page pattern for every clickable
// map layer (watches, warnings, MDs) rather than a one-off per layer. "View Details" hands off to
// mapFocusAlert.ts (read by AlertsFullPanel) plus the existing view-all-alerts navigation event --
// this function only owns showing the popup and wiring that one button.
export function showAlertPopup(map: MapboxMap, lngLat: [number, number], info: AlertPopupInfo) {
  activePopups.get(map)?.remove();
  const remaining = timeRemainingText(info.expires);
  const container = document.createElement("div");
  container.className = "atlas-alert-popup__body";
  container.innerHTML = `
    <strong>${escapeHtml(info.title)}</strong>
    <span>${escapeHtml(info.headline)}</span>
    ${remaining ? `<em>${escapeHtml(remaining)}</em>` : ""}
    <button type="button" class="atlas-alert-popup__button">View Details</button>
  `;
  container.querySelector("button")?.addEventListener("click", () => {
    requestAlertFocus(info.id);
    window.dispatchEvent(new Event("codeblack:view-all-alerts"));
    activePopups.get(map)?.remove();
  });
  const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: "atlas-alert-popup", maxWidth: "240px" })
    .setLngLat(lngLat)
    .setDOMContent(container)
    .addTo(map);
  activePopups.set(map, popup);
}
