import type { GeoJSONSource, Map } from "mapbox-gl";
import type { BreadcrumbPoint } from "../services/breadcrumbTrail";
import { incrementAtlasCounter } from "./AtlasDiagnostics";

const BREADCRUMB_SOURCE = "atlas-breadcrumb";
const BREADCRUMB_LAYER = "atlas-breadcrumb-trail";

export function updateAtlasBreadcrumbLayer(map: Map, trail: BreadcrumbPoint[]) {
  const line = {
    type: "FeatureCollection",
    features: trail.length < 2 ? [] : [{
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: trail.map((point) => [point.lon, point.lat]) },
    }],
  };

  const source = map.getSource(BREADCRUMB_SOURCE) as GeoJSONSource | undefined;
  if (source) {
    source.setData(line as never);
    incrementAtlasCounter("sourceUpdates");
  } else {
    map.addSource(BREADCRUMB_SOURCE, { type: "geojson", data: line as never });
    incrementAtlasCounter("sourceCreations");
  }

  if (!map.getLayer(BREADCRUMB_LAYER)) {
    // Inserted below the vehicle marker/heading/accuracy layers (added after this call the first
    // time around) so the trail always sits under the dot rather than drawing over it.
    map.addLayer({
      id: BREADCRUMB_LAYER,
      type: "line",
      source: BREADCRUMB_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ff2d35",
        "line-width": 3,
        "line-opacity": 0.32,
      },
    });
    incrementAtlasCounter("layerCreations");
  }
}
