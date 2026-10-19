// @vitest-environment node
import { describe, expect, it } from "vitest"
import { mergePolledSettings, radarSettingsEqual } from "../status/statusCenterClient"
import type { RadarControlSettings } from "../status/statusCenterClient"


const saved: RadarControlSettings = { primary_prewarm_enabled: true, primary_interval_seconds: 600 }
const polled: RadarControlSettings = { primary_prewarm_enabled: false, primary_interval_seconds: 900 }

describe("radar policy draft polling", () => {
  it("initializes the saved copy and missing draft", () => {
    expect(mergePolledSettings(null, null, polled)).toEqual({ savedSettings: polled, settings: polled })
    expect(mergePolledSettings(saved, null, polled).settings).toBe(polled)
  })

  it("refreshes a clean draft using value equality regardless of key order", () => {
    const draft = { primary_interval_seconds: saved.primary_interval_seconds, primary_prewarm_enabled: saved.primary_prewarm_enabled }
    expect(mergePolledSettings(saved, draft, polled)).toEqual({ savedSettings: polled, settings: polled })
  })

  it.each([
    { ...saved, primary_prewarm_enabled: false },
    { ...saved, primary_interval_seconds: 300 as const },
    { ...saved, secondary_prewarm_enabled: true },
  ])("preserves an edited draft while updating the saved copy: %j", (draft) => {
    const merged = mergePolledSettings(saved, draft, polled)
    expect(merged.savedSettings).toBe(polled)
    expect(merged.settings).toBe(draft)
    // A second poll must compare against the latest saved copy.
    expect(mergePolledSettings(merged.savedSettings, merged.settings, saved).settings).toBe(draft)
  })

  it("resumes draft updates after edits are reverted or discarded", () => {
    const merged = mergePolledSettings(saved, { ...saved, primary_interval_seconds: 300 }, polled)
    const discarded = merged.savedSettings
    expect(radarSettingsEqual(discarded, merged.savedSettings)).toBe(true)
    expect(mergePolledSettings(merged.savedSettings, discarded, saved).settings).toBe(saved)
    expect(mergePolledSettings(saved, { ...saved }, polled).settings).toBe(polled)
  })

  it("becomes clean when the server matches the draft", () => {
    const merged = mergePolledSettings(saved, { ...polled }, polled)
    expect(radarSettingsEqual(merged.settings, merged.savedSettings)).toBe(true)
  })

  it("compares all policy fields, including optional secondary prewarm", () => {
    expect(radarSettingsEqual(null, null)).toBe(true)
    expect(radarSettingsEqual(saved, null)).toBe(false)
    expect(radarSettingsEqual(saved, { ...saved, secondary_prewarm_enabled: undefined })).toBe(true)
    expect(radarSettingsEqual(saved, { ...saved, secondary_prewarm_enabled: false })).toBe(false)
  })
})
