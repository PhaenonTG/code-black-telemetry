import type { GeoJSONSource, Map } from "mapbox-gl";
import type { RoutePoint } from "../services/navigationRoute";
const SOURCE = "atlas-navigation-route"; const CASING = "atlas-navigation-route-casing"; const LINE = "atlas-navigation-route-line";
export function updateAtlasNavigationRouteLayer(map: Map, points: RoutePoint[], visible: boolean, beforeLayerId?: string) {
  const data = { type: "FeatureCollection", features: points.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points.map((point) => [point.lon, point.lat]) } }] : [] };
  const source = map.getSource(SOURCE) as GeoJSONSource | undefined; if (source) source.setData(data as never); else map.addSource(SOURCE, { type: "geojson", data: data as never });
  if (!map.getLayer(CASING)) map.addLayer({ id: CASING, type: "line", source: SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-width": 8, "line-opacity": .65 } }, beforeLayerId);
  if (!map.getLayer(LINE)) map.addLayer({ id: LINE, type: "line", source: SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ff321e", "line-width": 4, "line-opacity": .9, "line-dasharray": [2, 1] } }, beforeLayerId);
  for (const id of [CASING, LINE]) map.setLayoutProperty(id, "visibility", visible && points.length > 1 ? "visible" : "none");
}
