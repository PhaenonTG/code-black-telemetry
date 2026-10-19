import type { GeoJSONSource, Map } from "mapbox-gl";
import type { AtlasGpsPoint } from "./types";
import type { AtlasRangeRingMode } from "./types";
import { incrementAtlasCounter } from "./AtlasDiagnostics";
import { destinationPoint as destination } from "./viewport";

const SOURCE = "atlas-range-rings";
const LAYER = "atlas-range-rings";

function ringFeature(center: Pick<AtlasGpsPoint, "lat" | "lon">, miles: number) {
  const coordinates = [];
  for (let bearing = 0; bearing <= 360; bearing += 4) coordinates.push(destination(center.lat, center.lon, bearing, miles));
  return {
    type: "Feature",
    properties: { miles },
    geometry: { type: "LineString", coordinates },
  };
}

export function updateAtlasRangeRings(map: Map, center: Pick<AtlasGpsPoint, "lat" | "lon"> | null, mode: AtlasRangeRingMode) {
  const distances = mode === "off" ? [] : mode === "10" ? [10] : mode === "25" ? [25, 50, 75, 100] : mode === "50" ? [50, 100, 150] : [100, 200];
  const data = {
    type: "FeatureCollection",
    features: center ? distances.map((distanceMiles) => ringFeature(center, distanceMiles)) : [],
  };

  const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
  if (source) {
    source.setData(data as never);
    incrementAtlasCounter("sourceUpdates");
  } else {
    map.addSource(SOURCE, { type: "geojson", data: data as never });
    incrementAtlasCounter("sourceCreations");
  }

  if (!map.getLayer(LAYER)) {
    map.addLayer({
      id: LAYER,
      type: "line",
      source: SOURCE,
      paint: {
        "line-color": "rgba(235, 244, 255, 0.46)",
        "line-width": 1,
        "line-dasharray": [2, 3],
      },
    });
    incrementAtlasCounter("layerCreations");
  }
}
