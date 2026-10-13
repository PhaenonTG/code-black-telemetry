import { describe, expect, it } from "vitest"
import type { RoadConditionEvent } from "../../../../src/services/mapLayerModels"
import { distanceMiles, nearbyRoadConditions, routeRoadConditions, topOfficialAlert } from "./chaseIntelModel"

describe("Chase field-intel selection", () => {
  it("prioritizes active tornado warnings over severe warnings and expired products", () => {
    const now = Date.parse("2026-10-13T12:00:00Z")
    const picked = topOfficialAlert([
      { event: "Tornado Warning", expires: "2026-10-13T11:59:00Z" },
      { event: "Severe Thunderstorm Warning", expires: "2026-10-13T12:30:00Z" },
      { event: "Tornado Warning", expires: "2026-10-13T12:10:00Z" },
    ], now)
    expect(picked?.event).toBe("Tornado Warning")
    expect(picked?.expires).toBe("2026-10-13T12:10:00Z")
  })

  it("limits road context to nearby points and sorts by approximate distance", () => {
    const event = (id: string, lat: number, lon: number) => ({ id, lat, lon }) as RoadConditionEvent
    const point = { lat: 39.05, lon: -95.68 }
    expect(nearbyRoadConditions([event("far", 40, -95.68), event("near", 39.06, -95.68), event("nearer", 39.051, -95.68)], point).map(({ road }) => road.id)).toEqual(["nearer", "near"])
    expect(distanceMiles(point, point)).toBe(0)
  })

  it("keeps route road events near the line, ordered from the origin", () => {
    const event = (id: string, lat: number, lon: number) => ({ id, lat, lon }) as RoadConditionEvent
    const origin = { lat: 36.45, lon: -94.12 }
    const route = [origin, { lat: 36.45, lon: -93.12 }]
    const matches = routeRoadConditions([
      event("beyond", 36.6, -93.8),
      event("later", 36.46, -93.3),
      event("sooner", 36.45, -94.0),
    ], origin, route)
    expect(matches.map(({ road }) => road.id)).toEqual(["sooner", "later"])
    expect(routeRoadConditions([event("sooner", 36.45, -94.0)], origin, [])).toEqual([])
  })
})
