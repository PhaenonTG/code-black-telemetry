import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("./core/client", () => ({ currentAccessToken: async () => "qa-token", buildCoreRequestHeaders: (token: string) => ({ Authorization: `Bearer ${token}` }), OpsCoreClientError: Error }))
import { analyzeTargetWithRadar, assessmentSections, assessmentSummary, validateAssessment } from "./localAiAdvisory"
import { readOpsCoreConfig } from "./core/config"
const config = readOpsCoreConfig({ VITE_CODEBLACK_CORE_BASE_URL: "https://qa.example/api/core" })
const value = { status: "available", generated_at: "2026-10-12T10:00:00Z", context: { latitude: 36, longitude: -94, context_type: "SELECTED_TARGET" }, assessment: { environment_summary: "Actual guarded environment summary", recommended_attention: ["Check the next scan"], uncertainties: ["Incomplete velocity coverage"] }, radar_evidence: {} }
afterEach(() => vi.unstubAllGlobals())
describe("Local model contract", () => {
  it("reads the real model summary and evidence lists", () => {
    const assessment = validateAssessment(value)
    expect(assessmentSummary(assessment)).toBe("Actual guarded environment summary")
    expect(assessmentSections(assessment)).toContainEqual({ label: "Attention", lines: ["Check the next scan"] })
    expect(assessmentSummary({ ...assessment, status: "unavailable", reason: "guard_rejected" })).toBe("guard_rejected")
    expect(assessmentSections({ ...assessment, status: "unavailable" })).toEqual([])
  })
  it("rejects malformed envelopes", () => {
    for (const input of [null, [], {}, { ...value, generated_at: "bad" }, { ...value, status: "trusted" }, { ...value, reason: {} }, { ...value, assessment: "oops" }, { ...value, guard_reasons: [4] }, { ...value, context: { unit_id: {} } }, { ...value, model: { host: {} } }, { ...value, snapshot_id: {} }, { ...value, assessment_generated_at: "invalid" }, { ...value, valid_for_seconds: -1 }]) expect(() => validateAssessment(input)).toThrow()
  })
  it("sends exact coordinates, auth and cancellation, without model/provider overrides", async () => {
    const fetch = vi.fn(async () => Response.json(value)); vi.stubGlobal("fetch", fetch)
    const controller = new AbortController()
    expect(await analyzeTargetWithRadar(config, { lat: 36, lon: -94 }, controller.signal)).toEqual(value)
    expect(fetch).toHaveBeenCalledWith("https://qa.example/api/core/api/ai/v1/target-analysis", expect.objectContaining({ method: "POST", signal: controller.signal, cache: "no-store", body: '{"latitude":36,"longitude":-94}', headers: expect.objectContaining({ Authorization: "Bearer qa-token" }) }))
  })
  it("rejects a response for a different point and invalid requests", async () => {
    const fetch = vi.fn(async () => Response.json(value)); vi.stubGlobal("fetch", fetch)
    await expect(analyzeTargetWithRadar(config, { lat: 36.000001, lon: -94 })).rejects.toThrow(/different target/)
    await expect(analyzeTargetWithRadar(config, { lat: NaN, lon: -94 })).rejects.toThrow(/Invalid/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
