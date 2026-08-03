import type { GeoJSONSource, Map, MapMouseEvent } from "mapbox-gl";
import type { AlertProduct } from "../services/situational";
import { incrementAtlasCounter } from "./AtlasDiagnostics";
import { showAlertPopup } from "./AtlasAlertPopup";

const ATLAS_ALERTS_SOURCE = "atlas-alerts";
const ATLAS_ALERTS_FILL_LAYER = "atlas-alerts-fill";
const ATLAS_ALERTS_LINE_LAYER = "atlas-alerts-line";
const ATLAS_MD_LINE_LAYER = "atlas-md-line";

// Core storm-based warnings (the ones that actually carry a precise NWS polygon, per research --
// most watches/statements are zone-based with no geometry at all) render filled + solid red.
// Anything else with geometry (rare, but not impossible) still gets a solid outline in the app's
// established amber "watch" color rather than being silently dropped. MDs get their own dashed,
// unfilled outline -- they're a discussion, not yet a warning, and should read that way at a glance.
const WARNING_SEVERITIES = ["tornado", "pds", "severe", "flash-flood"];
const RED = "#ff2d35";
const AMBER = "#f4b623";
const MD_COLOR = "#f4f6fa";

// Latest alert data per map, keyed off the same id embedded in each GeoJSON feature's properties
// -- the click handler below is attached once and reads this fresh on every click rather than
// closing over whatever `alerts` was at attach time.
const latestAlertsById = new WeakMap<Map, Record<string, AlertProduct>>();
const clickHandlerAttached = new WeakSet<Map>();

function attachAlertClickHandler(map: Map) {
  if (clickHandlerAttached.has(map)) return;
  clickHandlerAttached.add(map);
  const handleClick = (event: MapMouseEvent) => {
    const features = event.features as Array<{ properties?: Record<string, unknown> }> | undefined;
    const id = features?.[0]?.properties?.id as string | undefined;
    const alert = id ? latestAlertsById.get(map)?.[id] : undefined;
    if (!alert) return;
    showAlertPopup(map, [event.lngLat.lng, event.lngLat.lat], {
      id: alert.id,
      title: alert.title,
      headline: alert.headline,
      expires: alert.expires,
    });
  };
  for (const layerId of [ATLAS_ALERTS_FILL_LAYER, ATLAS_ALERTS_LINE_LAYER, ATLAS_MD_LINE_LAYER]) {
    map.on("click", layerId, handleClick as (event: MapMouseEvent) => void);
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
  }
}

function toFeatureCollection(alerts: AlertProduct[]) {
  return {
    type: "FeatureCollection",
    features: alerts
      .filter((alert) => alert.geometry)
      .map((alert) => ({
        type: "Feature",
        properties: { id: alert.id, severity: alert.severity },
        geometry: alert.geometry,
      })),
  };
}

export function updateAtlasAlertsLayer(map: Map, alerts: AlertProduct[], visible: boolean, beforeLayerId?: string) {
  const collection = toFeatureCollection(alerts);
  latestAlertsById.set(map, Object.fromEntries(alerts.map((alert) => [alert.id, alert])));

  const source = map.getSource(ATLAS_ALERTS_SOURCE) as GeoJSONSource | undefined;
  if (source) {
    source.setData(collection as never);
    incrementAtlasCounter("sourceUpdates");
  } else {
    map.addSource(ATLAS_ALERTS_SOURCE, { type: "geojson", data: collection as never });
    incrementAtlasCounter("sourceCreations");
  }

  if (!map.getLayer(ATLAS_ALERTS_FILL_LAYER)) {
    map.addLayer({
      id: ATLAS_ALERTS_FILL_LAYER,
      type: "fill",
      source: ATLAS_ALERTS_SOURCE,
      filter: ["in", ["get", "severity"], ["literal", WARNING_SEVERITIES]],
      paint: { "fill-color": RED, "fill-opacity": 0.16 },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  if (!map.getLayer(ATLAS_ALERTS_LINE_LAYER)) {
    map.addLayer({
      id: ATLAS_ALERTS_LINE_LAYER,
      type: "line",
      source: ATLAS_ALERTS_SOURCE,
      filter: ["!=", ["get", "severity"], "md"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["match", ["get", "severity"], WARNING_SEVERITIES, RED, AMBER],
        "line-width": 2,
      },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  if (!map.getLayer(ATLAS_MD_LINE_LAYER)) {
    map.addLayer({
      id: ATLAS_MD_LINE_LAYER,
      type: "line",
      source: ATLAS_ALERTS_SOURCE,
      filter: ["==", ["get", "severity"], "md"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": MD_COLOR,
        "line-width": 1.5,
        "line-dasharray": [2, 2],
        "line-opacity": 0.7,
      },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  attachAlertClickHandler(map);

  const visibility = visible ? "visible" : "none";
  for (const layerId of [ATLAS_ALERTS_FILL_LAYER, ATLAS_ALERTS_LINE_LAYER, ATLAS_MD_LINE_LAYER]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  }
}
