import { describe, expect, it } from "vitest"
import { revisionChanges, revisionHasDisplayedChange, type SetupRevisionEntry } from "./setupRevisionModel"

const entry = { revision: 21, compared_to_revision: 20, changes: ["official_area", "model_runs", "screening_points"] } as SetupRevisionEntry

describe("Setup revision change wording", () => {
  it("describes only evidence changes supplied by Core", () => {
    expect(revisionChanges(entry)).toEqual(["SPC outlook area changed", "Retained HRRR run changed", "Retained screening points changed"])
  })
  it("does not infer a comparison when older evidence was never captured", () => {
    expect(revisionChanges({ ...entry, compared_to_revision: null, changes: null })).toEqual(["No earlier captured revision to compare."])
  })
  it("separates unchanged revision noise from meaningful changes", () => {
    expect(revisionHasDisplayedChange({ ...entry, changes: [] })).toBe(false)
    expect(revisionHasDisplayedChange(entry)).toBe(true)
  })
})
