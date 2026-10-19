import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { ChaserNetMapMember, ChaserNetReport } from "../services/chaserNet";
import type { PinStyle } from "../services/settings";
import type { MapCluster } from "./viewport";
import { syncAtlasPinMarkers } from "./AtlasPinMarkers";

const chaserNetMarkers = new WeakMap<MapboxMap, Record<string, Marker>>();
const chaserNetReportMarkers = new WeakMap<MapboxMap, Record<string, Marker>>();

function isCluster<T extends { id: string; lat: number; lon: number }>(point: T | MapCluster<T>): point is MapCluster<T> {
  return "count" in point;
}

export function updateAtlasChaserNetLayer(map: MapboxMap, members: Array<ChaserNetMapMember | MapCluster<ChaserNetMapMember>>, style: PinStyle, visible: boolean) {
  let markers = chaserNetMarkers.get(map);
  if (!markers) {
    markers = {};
    chaserNetMarkers.set(map, markers);
  }
  const points = members.map((member) => isCluster(member)
    ? { id: member.id, lat: member.lat, lon: member.lon, name: `${member.count} Chaser Net members`, clusterCount: member.count, family: "chaser" as const }
    : {
      id: member.id,
      lat: member.lat,
      lon: member.lon,
      name: member.callsign || member.displayName,
      updatedAtText: new Date(member.locationUpdatedAt).toISOString(),
      group: [member.team, member.status, member.verificationLevel].filter(Boolean).join(" / "),
      family: "chaser" as const,
      stale: member.stale,
    });
  syncAtlasPinMarkers(map, markers, points, style, visible);
}

export type ChaserNetReportMapPoint = ChaserNetReport & { id: string };

export function chaserNetReportToMapPoint(report: ChaserNetReport): ChaserNetReportMapPoint {
  return { ...report, id: report.reportId };
}

export function updateAtlasChaserNetReportLayer(map: MapboxMap, reports: Array<ChaserNetReportMapPoint | MapCluster<ChaserNetReportMapPoint>>, style: PinStyle, visible: boolean) {
  let markers = chaserNetReportMarkers.get(map);
  if (!markers) {
    markers = {};
    chaserNetReportMarkers.set(map, markers);
  }
  const points = reports.map((report) => isCluster(report)
    ? { id: report.id, lat: report.lat, lon: report.lon, name: `${report.count} Chaser Net reports`, clusterCount: report.count, family: "report" as const }
    : {
      id: report.reportId,
      lat: report.lat,
      lon: report.lon,
      name: `${report.category.replace(/-/g, " ")} - ${report.confidence}`,
      updatedAtText: new Date(report.timestampUtc).toISOString(),
      group: `${report.verificationState} / ${report.provenance.displayLabel}`,
      family: "report" as const,
      stale: report.moderationState !== "clear",
    });
  syncAtlasPinMarkers(map, markers, points, style, visible);
}
