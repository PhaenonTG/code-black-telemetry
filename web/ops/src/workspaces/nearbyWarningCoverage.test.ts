import { afterEach, describe, expect, it, vi } from "vitest"

const warning = {
  id: "https://api.weather.gov/alerts/123",
  properties: { event: "Tornado Warning", areaDesc: "Benton County" },
  geometry: { type: "Polygon", coordinates: [[[-94.2, 36.4], [-94.0, 36.4], [-94.0, 36.5], [-94.2, 36.5], [-94.2, 36.4]]] },
}

function json(value: unknown, status = 200) {
  return { ok: status === 200, status, statusText: status === 200 ? "OK" : "Unavailable", json: async () => value }
}

afterEach(() => vi.unstubAllGlobals())

describe("nearby warning state coverage", () => {
  it("uses the reference point's state and an adjacent state, then deduplicates alerts", async () => {
    vi.resetModules()
    const { getNearbyStormThreats } = await import("../../../../src/services/situational")
    const urls: string[] = []
    vi.stubGlobal("window", globalThis)
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      urls.push(input)
      if (input.includes("/points/")) {
        const lat = Number(input.split("/points/")[1].split(",")[0])
        const state = lat > 36.8 ? "MOC077" : "ARC007"
        return json({ properties: { county: `https://api.weather.gov/zones/county/${state}`, relativeLocation: { properties: { state: "MO" } } } })
      }
      return json({ features: [warning] })
    }))

    const result = await getNearbyStormThreats({ lat: 36.456, lon: -94.121 })
    expect(result.states).toEqual(["AR", "MO"])
    expect(result.complete).toBe(true)
    expect(result.threats).toHaveLength(1)
    expect(urls.filter((url) => url.includes("alerts/active?area="))).toEqual([
      "https://api.weather.gov/alerts/active?area=AR",
      "https://api.weather.gov/alerts/active?area=MO",
    ])
  })

  it("marks coverage incomplete when an adjacent state's alert feed fails", async () => {
    vi.resetModules()
    const { getNearbyStormThreats } = await import("../../../../src/services/situational")
    vi.stubGlobal("window", globalThis)
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input.includes("/points/")) {
        const lat = Number(input.split("/points/")[1].split(",")[0])
        return json({ properties: { county: `https://api.weather.gov/zones/county/${lat > 37 ? "MOC077" : "ARC007"}` } })
      }
      return input.endsWith("area=MO") ? json({}, 503) : json({ features: [warning] })
    }))

    const result = await getNearbyStormThreats({ lat: 36.7, lon: -94.3 })
    expect(result.states).toEqual(["AR", "MO"])
    expect(result.complete).toBe(false)
    expect(result.threats).toHaveLength(1)
  })
})
