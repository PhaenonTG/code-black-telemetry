import type { RoadConditionEvent } from "../../../../src/services/mapLayerModels"

export type ChasePoint = { lat: number; lon: number }
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
