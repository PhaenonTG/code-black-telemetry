import { describe, expect, it } from "vitest"
import { parsePotential } from "./tornadoPotentialModel"
describe("independent potential grid integrity", () => {
  it("accepts missing coverage honestly without manufacturing a low-risk layer", () => {
    const value = parsePotential({ schema: "codeblack.tornado-potential.v1", type: "FeatureCollection", status: "unavailable", frames: [], features: [] })
    expect(value.status).toBe("unavailable")
    expect(value.features).toEqual([])
  })
  it("rejects unknown tier values and invalid geography", () => {
    const value = { schema: "codeblack.tornado-potential.v1", type: "FeatureCollection", status: "available", frames: [], features: [{
      type: "Feature", geometry: { type: "Polygon", coordinates: [[[-98, 35], [-97, 35], [-97, 36], [-98, 35]]] },
      properties: { tier: 2, index_mean: 1.2 } }] }
    expect(parsePotential(value).features).toHaveLength(1)
    value.features[0].properties.tier = 99
    expect(() => parsePotential(value)).toThrow()
    value.features[0].properties.tier = 2
    value.features[0].geometry.coordinates[0][0][0] = 300
    expect(() => parsePotential(value)).toThrow()
  })
})
