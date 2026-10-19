import type { RoadConditionEvent } from "../../../../src/services/mapLayerModels"
import { distanceToRouteMiles, type RoutePoint } from "../../../../src/services/navigationRoute"

export type ChasePoint = { lat: number; lon: number }

// Refresh field intelligence after roughly a third of a mile of movement without
// restarting every request for normal GPS jitter.
export function chaseIntelRefreshKey(point: ChasePoint | null): string {
  return point ? `${Math.round(point.lat * 200)},${Math.round(point.lon * 200)}` : ""
}
export type OfficialAlert = { id?: string; event?: string; headline?: string; severity?: string; expires?: string; source_url?: string }

export function distanceMiles(a: ChasePoint, b: ChasePoint) {
  const radius = 3958.8
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const latA = a.lat * Math.PI / 180
  const latB = b.lat * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)))
}

function officialPriority(alert: OfficialAlert) {
  const event = (alert.event ?? alert.headline ?? "").toLowerCase()
  if (event.includes("tornado warning")) return 0
  if (event.includes("severe thunderstorm warning")) return 1
  if (event.includes("flash flood warning")) return 2
  if (event.includes("warning")) return 3
  if (event.includes("watch")) return 4
  return 5
}

export function topOfficialAlert(alerts: OfficialAlert[], now = Date.now()) {
  return alerts.filter((alert) => !alert.expires || !Number.isFinite(Date.parse(alert.expires)) || Date.parse(alert.expires) > now)
    .toSorted((a, b) => officialPriority(a) - officialPriority(b) || (Date.parse(a.expires ?? "") || Infinity) - (Date.parse(b.expires ?? "") || Infinity))[0] ?? null
}

export function nearbyRoadConditions(roads: RoadConditionEvent[], point: ChasePoint, maxMiles = 25) {
  return roads.flatMap((road) => Number.isFinite(road.lat) && Number.isFinite(road.lon)
    ? [{ road, distanceMi: distanceMiles(point, { lat: road.lat, lon: road.lon }) }]
    : [])
    .filter((entry) => entry.distanceMi <= maxMiles)
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, 5)
}

export function routeRoadConditions(roads: RoadConditionEvent[], origin: ChasePoint, route: RoutePoint[], corridorMiles = 5) {
  if (route.length < 2) return []
  return roads.flatMap((road) => Number.isFinite(road.lat) && Number.isFinite(road.lon)
    ? [{ road, distanceMi: distanceMiles(origin, { lat: road.lat, lon: road.lon }), routeDistanceMi: distanceToRouteMiles(road, route) }]
    : [])
    .filter((entry) => entry.routeDistanceMi <= corridorMiles)
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, 8)
}
