import type { GeoJSONSource, Map, MapMouseEvent } from "mapbox-gl";
import type { AlertProduct } from "../services/situational";
import { incrementAtlasCounter } from "./AtlasDiagnostics";
import { showAlertPopup } from "./AtlasAlertPopup";

const ATLAS_ALERTS_SOURCE = "atlas-alerts";
export const ATLAS_ALERTS_FILL_LAYER = "atlas-alerts-fill";
export const ATLAS_ALERTS_LINE_LAYER = "atlas-alerts-line";
const ATLAS_ALERTS_WATCH_LINE_LAYER = "atlas-alerts-watch-line";
const ATLAS_ALERTS_STATEMENT_LINE_LAYER = "atlas-alerts-statement-line";
const ATLAS_MD_LINE_LAYER = "atlas-md-line";

const ALL_ALERT_LAYER_IDS = [
  ATLAS_ALERTS_FILL_LAYER,
  ATLAS_ALERTS_LINE_LAYER,
  ATLAS_ALERTS_WATCH_LINE_LAYER,
  ATLAS_ALERTS_STATEMENT_LINE_LAYER,
  ATLAS_MD_LINE_LAYER,
];

// Core storm-based warnings (the ones that actually carry a precise NWS polygon, per research --
// most watches/statements are zone-based with no geometry at all) render filled + solid red.
// Watch-severity and "other" (special statements/advisories) items that do carry geometry get
// their own amber/blue outline layers instead of being silently dropped or lumped together --
// each is independently toggleable (see visibility param below), matching the four layers a
// chaser actually wants to turn on/off separately: Warnings, Watches, Mesoscale Discussions,
// Special Statements. MDs get their own dashed, unfilled outline -- they're a discussion, not yet
// a warning, and should read that way at a glance.
const WARNING_SEVERITIES = ["tornado", "pds", "severe", "flash-flood"];
const RED = "#ff2d35";
const AMBER = "#f4b623";
const BLUE = "#4da3ff";
const MD_COLOR = "#f4f6fa";

export interface AlertLayerVisibility {
  warnings: boolean;
  watches: boolean;
  mesoscaleDiscussions: boolean;
  specialStatements: boolean;
}

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
    showAlertPopup(map, [event.lngLat.lng, event.lngLat.lat], alert);
  };
  for (const layerId of ALL_ALERT_LAYER_IDS) {
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

export function updateAtlasAlertsLayer(map: Map, alerts: AlertProduct[], visibility: AlertLayerVisibility, beforeLayerId?: string) {
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
      paint: { "fill-color": RED, "fill-opacity": 0.13 },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  if (!map.getLayer(ATLAS_ALERTS_LINE_LAYER)) {
    map.addLayer({
      id: ATLAS_ALERTS_LINE_LAYER,
      type: "line",
      source: ATLAS_ALERTS_SOURCE,
      filter: ["in", ["get", "severity"], ["literal", WARNING_SEVERITIES]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": RED, "line-width": 3, "line-opacity": 0.96 },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  if (!map.getLayer(ATLAS_ALERTS_WATCH_LINE_LAYER)) {
    map.addLayer({
      id: ATLAS_ALERTS_WATCH_LINE_LAYER,
      type: "line",
      source: ATLAS_ALERTS_SOURCE,
      filter: ["==", ["get", "severity"], "watch"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": AMBER, "line-width": 2 },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  if (!map.getLayer(ATLAS_ALERTS_STATEMENT_LINE_LAYER)) {
    map.addLayer({
      id: ATLAS_ALERTS_STATEMENT_LINE_LAYER,
      type: "line",
      source: ATLAS_ALERTS_SOURCE,
      filter: ["==", ["get", "severity"], "other"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": BLUE, "line-width": 1.5, "line-dasharray": [3, 1.5] },
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

  const setVisible = (layerId: string, visible: boolean) => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  };
  setVisible(ATLAS_ALERTS_FILL_LAYER, visibility.warnings);
  setVisible(ATLAS_ALERTS_LINE_LAYER, visibility.warnings);
  setVisible(ATLAS_ALERTS_WATCH_LINE_LAYER, visibility.watches);
  setVisible(ATLAS_ALERTS_STATEMENT_LINE_LAYER, visibility.specialStatements);
  setVisible(ATLAS_MD_LINE_LAYER, visibility.mesoscaleDiscussions);
}
