import { describe, expect, it } from "vitest"
import { validateSetupIndex, validateSetupDraft } from "./setupValidation"
const id = "setup-20261012-1234567890"
const at = "2026-10-12T00:00:00Z"
describe("private setup payload integrity", () => {
  it("accepts an honest empty index", () => expect(validateSetupIndex({ status: "pending", checked_at: at, items: [] }).items).toEqual([]))
  it("rejects invalid lists and unqueryable setup identities", () => {
    expect(() => validateSetupIndex({ status: "ready", items: {} })).toThrow()
    expect(() => validateSetupIndex({ status: "ready", items: [{ setup_id: "../../admin" }] })).toThrow()
  })
  it("rejects a response for a different setup", () => expect(() => validateSetupDraft({ setup_id: "wrong" }, id)).toThrow())
  it("rejects invalid coordinates and missing evidence before rendering", () => {
    const draft = { setup_id: id, summary: "Test", generated_at: at, bounds: [-96, 35, -92, 38], model: { target_points: [{ latitude: 100, longitude: -94, score_index: 50, classification: "Test", valid_time: at }] }, official: {}, review: {} }
    expect(() => validateSetupDraft(draft, id)).toThrow()
    draft.model.target_points[0].latitude = 36
    expect(validateSetupDraft(draft, id).model.target_points[0].latitude).toBe(36)
    expect(() => validateSetupDraft({ ...draft, model: { ...draft.model, status: {} } }, id)).toThrow()
    expect(() => validateSetupDraft({ ...draft, official: { source_url: "javascript:alert(1)" } }, id)).toThrow()
  })
  it("accepts a sourced tornado tracking polygon and rejects malformed geometry", () => {
    const draft = { setup_id: id, summary: "Test", generated_at: at, bounds: [-96, 35, -92, 38],
      model: { target_points: [] }, official: {}, review: {}, tornado_tracking_map: {
        schema: "codeblack.chase.tornado-tracking-map.v1", features: [{ type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[-96, 35], [-95, 35], [-95, 36], [-96, 35]]] },
          properties: { official_risk_label: "5%", official_risk_code: 5 } }] } }
    expect(validateSetupDraft(draft, id).tornado_tracking_map?.features).toHaveLength(1)
    draft.tornado_tracking_map.features[0].geometry.coordinates[0][0][0] = 300
    expect(() => validateSetupDraft(draft, id)).toThrow("Malformed tornado tracking map")
  })
})
