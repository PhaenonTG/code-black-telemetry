import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { TeamPosition } from "../services/teamPositions";
import type { PinStyle } from "../services/settings";
import { syncAtlasPinMarkers } from "./AtlasPinMarkers";

const teamMarkers = new WeakMap<MapboxMap, Record<string, Marker>>();

export function updateAtlasTeamLayer(map: MapboxMap, team: TeamPosition[], style: PinStyle, visible: boolean) {
  let markers = teamMarkers.get(map);
  if (!markers) {
    markers = {};
    teamMarkers.set(map, markers);
  }
  const points = team.map((member) => ({ id: member.id, lat: member.lat, lon: member.lon }));
  syncAtlasPinMarkers(map, markers, points, style, visible);
}
