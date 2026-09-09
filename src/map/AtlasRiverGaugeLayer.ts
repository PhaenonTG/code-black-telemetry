import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { RiverGaugeObservation } from "../services/riverGaugeProvider";
import type { PinStyle } from "../services/settings";
import { syncAtlasPinMarkers, type PinPoint } from "./AtlasPinMarkers";

const markersByMap = new WeakMap<MapboxMap, Record<string, Marker>>();
const GAUGE_STYLE: PinStyle = { color: "#22d3ee", shape: "circle", sizeScale: 0.75 };

function toPin(gauge: RiverGaugeObservation): PinPoint {
  const trend = gauge.trendFeetPerHour == null ? "trend unavailable" : Math.abs(gauge.trendFeetPerHour) < 0.02 ? "steady" : `${gauge.trendFeetPerHour > 0 ? "rising" : "falling"} ${Math.abs(gauge.trendFeetPerHour).toFixed(2)} ft/hr`;
  const category = gauge.floodCategory.replaceAll("_", " ").toUpperCase();
  return { id: gauge.id, lat: gauge.lat, lon: gauge.lon, name: gauge.name, group: "NOAA / USGS RIVER GAUGE", statusLine: `${gauge.stageFeet.toFixed(2)} ft · ${category} · ${trend}`, detailRows: [{ label: "Action", value: gauge.thresholds.action == null ? "--" : `${gauge.thresholds.action} ft` }, { label: "Minor", value: gauge.thresholds.minor == null ? "--" : `${gauge.thresholds.minor} ft` }, { label: "Moderate", value: gauge.thresholds.moderate == null ? "--" : `${gauge.thresholds.moderate} ft` }, { label: "Major", value: gauge.thresholds.major == null ? "--" : `${gauge.thresholds.major} ft` }], family: "station", stale: Date.now() - gauge.observedAt > 60 * 60_000 };
}

export function updateAtlasRiverGaugeLayer(map: MapboxMap, gauges: RiverGaugeObservation[], visible: boolean) {
  let markers = markersByMap.get(map); if (!markers) { markers = {}; markersByMap.set(map, markers); }
  syncAtlasPinMarkers(map, markers, gauges.map(toPin), GAUGE_STYLE, visible);
}
