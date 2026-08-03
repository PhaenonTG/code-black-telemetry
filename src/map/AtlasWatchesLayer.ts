import type { GeoJSONSource, Map, MapMouseEvent } from "mapbox-gl";
import type { AlertProduct } from "../services/situational";
import type { WatchPolygon } from "../services/watches";
import { incrementAtlasCounter } from "./AtlasDiagnostics";
import { showAlertPopup } from "./AtlasAlertPopup";

const ATLAS_WATCHES_SOURCE = "atlas-watches";
const ATLAS_WATCHES_FILL_LAYER = "atlas-watches-fill";
const ATLAS_WATCHES_LINE_LAYER = "atlas-watches-line";
const AMBER = "#f4b623";

function toFeatureCollection(watches: WatchPolygon[]) {
  return {
    type: "FeatureCollection",
    features: watches.map((watch) => ({
      type: "Feature",
      properties: { id: watch.id, prodType: watch.prodType, expires: watch.expires },
      geometry: watch.geometry,
    })),
  };
}

const latestWatchesById = new WeakMap<Map, Record<string, WatchPolygon>>();
// The watch polygon (this NWS ArcGIS service) and the richer alert text/headline (already fetched
// via getNwsAlerts() for the Alerts page) share the same CAP id -- keeping both keyed the same way
// means a click can show the real headline when it's available, and still fall back to the ArcGIS
// feature's own prod_type/expiration when a matching alert hasn't been fetched (e.g. this device's
// point-based alert query doesn't happen to include a watch whose polygon still overlaps the map's
// current view).
const latestAlertsById = new WeakMap<Map, Record<string, AlertProduct>>();
const clickHandlerAttached = new WeakSet<Map>();

function attachWatchClickHandler(map: Map) {
  if (clickHandlerAttached.has(map)) return;
  clickHandlerAttached.add(map);
  const handleClick = (event: MapMouseEvent) => {
    const features = event.features as Array<{ properties?: Record<string, unknown> }> | undefined;
    const id = features?.[0]?.properties?.id as string | undefined;
    if (!id) return;
    const watch = latestWatchesById.get(map)?.[id];
    const alert = latestAlertsById.get(map)?.[id];
    const title = alert?.title ?? watch?.prodType ?? "Watch";
    const headline = alert?.headline ?? "";
    const expires = alert?.expires ?? watch?.expires ?? "";
    showAlertPopup(map, [event.lngLat.lng, event.lngLat.lat], { id, title, headline, expires });
  };
  for (const layerId of [ATLAS_WATCHES_FILL_LAYER, ATLAS_WATCHES_LINE_LAYER]) {
    map.on("click", layerId, handleClick as (event: MapMouseEvent) => void);
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
  }
}

export function updateAtlasWatchesLayer(map: Map, watches: WatchPolygon[], alerts: AlertProduct[], visible: boolean, beforeLayerId?: string) {
  const collection = toFeatureCollection(watches);
  latestWatchesById.set(map, Object.fromEntries(watches.map((watch) => [watch.id, watch])));
  latestAlertsById.set(map, Object.fromEntries(alerts.map((alert) => [alert.id, alert])));

  const source = map.getSource(ATLAS_WATCHES_SOURCE) as GeoJSONSource | undefined;
  if (source) {
    source.setData(collection as never);
    incrementAtlasCounter("sourceUpdates");
  } else {
    map.addSource(ATLAS_WATCHES_SOURCE, { type: "geojson", data: collection as never });
    incrementAtlasCounter("sourceCreations");
  }

  if (!map.getLayer(ATLAS_WATCHES_FILL_LAYER)) {
    map.addLayer({
      id: ATLAS_WATCHES_FILL_LAYER,
      type: "fill",
      source: ATLAS_WATCHES_SOURCE,
      // Matches the existing warnings fill's visual weight (AtlasAlertsLayer.ts) so watches read as
      // part of the same "Alerts" language rather than standing out or disappearing.
      paint: { "fill-color": AMBER, "fill-opacity": 0.16 },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  if (!map.getLayer(ATLAS_WATCHES_LINE_LAYER)) {
    map.addLayer({
      id: ATLAS_WATCHES_LINE_LAYER,
      type: "line",
      source: ATLAS_WATCHES_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": AMBER,
        "line-width": 1.5,
        "line-dasharray": [4, 2],
        "line-opacity": 0.85,
      },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  attachWatchClickHandler(map);

  const visibility = visible ? "visible" : "none";
  for (const layerId of [ATLAS_WATCHES_FILL_LAYER, ATLAS_WATCHES_LINE_LAYER]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  }
}
