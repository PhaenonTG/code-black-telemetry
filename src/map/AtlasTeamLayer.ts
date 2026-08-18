import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { TeamPosition } from "../services/teamPositions";
import type { PinStyle } from "../services/settings";
import { syncAtlasPinMarkers } from "./AtlasPinMarkers";
import type { MapCluster } from "./viewport";

const teamMarkers = new WeakMap<MapboxMap, Record<string, Marker>>();

function isCluster(point: TeamPosition | MapCluster<TeamPosition>): point is MapCluster<TeamPosition> {
  return "count" in point;
}

export function updateAtlasTeamLayer(map: MapboxMap, team: Array<TeamPosition | MapCluster<TeamPosition>>, style: PinStyle, visible: boolean) {
  let markers = teamMarkers.get(map);
  if (!markers) {
    markers = {};
    teamMarkers.set(map, markers);
  }
  const points = team.map((member) => isCluster(member)
    ? { id: member.id, lat: member.lat, lon: member.lon, name: `${member.count} team units`, clusterCount: member.count, family: "team" as const }
    : { id: member.id, lat: member.lat, lon: member.lon, name: member.name, updatedAtText: member.updatedAtText, group: member.group, phone: member.phone, email: member.email, family: "team" as const });
  syncAtlasPinMarkers(map, markers, points, style, visible);
}
