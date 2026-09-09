import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { StormReport } from "../services/stormReports";
import type { PinStyle } from "../services/settings";
import { reportAgeText } from "../services/stormReports";
import { syncAtlasPinMarkers, type PinPoint } from "./AtlasPinMarkers";

const markersByMap = new WeakMap<MapboxMap, Record<string, Marker>>();
const REPORT_STYLE: PinStyle = { color: "#f59e0b", shape: "diamond", sizeScale: 0.82 };

function toPin(report: StormReport): PinPoint {
  const ageMinutes = Math.max(0, (Date.now() - report.validTime) / 60_000);
  return {
    id: `storm-report-${report.id}`,
    lat: report.lat,
    lon: report.lon,
    name: report.type,
    group: `${report.source} STORM REPORT`,
    statusLine: [report.location, report.magnitude, reportAgeText(report.validTime)].filter(Boolean).join(" · "),
    family: "report",
    stale: ageMinutes > 45,
  };
}

export function updateAtlasStormReportLayer(map: MapboxMap, reports: StormReport[], visible: boolean) {
  let markers = markersByMap.get(map);
  if (!markers) { markers = {}; markersByMap.set(map, markers); }
  syncAtlasPinMarkers(map, markers, reports.map(toPin), REPORT_STYLE, visible);
}
