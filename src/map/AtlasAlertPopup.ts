import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, Popup } from "mapbox-gl";
import type { AlertProduct } from "../services/situational";
import { timeRemainingText } from "../services/situational";
import { requestAlertFocus } from "../services/mapFocusAlert";

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

// "VIEW DETAILS" does two things at once, so both existing consumers of this shared map layer
// keep working: it dispatches codeblack:map-alert-open (web/ops's in-map MapSituationPanel,
// added in Map Update 2) *and* still calls requestAlertFocus + dispatches
// codeblack:view-all-alerts (the native app's existing full-page Alerts panel navigation,
// src/App.tsx). Only the web app renders a MapSituationPanel; only the native app has an Alerts
// route to navigate to -- each side's listener simply ignores the event it doesn't use.
export function showAlertPopup(map: MapboxMap, lngLat: [number, number], alert: AlertProduct) {
  activePopups.get(map)?.remove();
  const remaining = timeRemainingText(alert.expires);
  const container = document.createElement("div");
  container.className = "atlas-alert-popup__body";
  container.innerHTML = `
    <strong>${escapeHtml(alert.title)}</strong>
    <span>${escapeHtml(alert.headline)}</span>
    ${remaining ? `<em>${escapeHtml(remaining)}</em>` : ""}
    <button type="button" class="atlas-alert-popup__button">VIEW DETAILS</button>
  `;
  container.querySelector("button")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent<AlertProduct>("codeblack:map-alert-open", { detail: alert }));
    requestAlertFocus(alert.id);
    window.dispatchEvent(new Event("codeblack:view-all-alerts"));
    activePopups.get(map)?.remove();
  });
  const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, offset: 12, className: "atlas-alert-popup", maxWidth: "240px" })
    .setLngLat(lngLat)
    .setDOMContent(container)
    .addTo(map);
  activePopups.set(map, popup);
}
