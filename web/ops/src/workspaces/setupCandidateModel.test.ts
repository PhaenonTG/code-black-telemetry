import { describe, expect, it } from "vitest"
import { rankedCandidates, setupChronology } from "./setupCandidateModel"

describe("private setup evidence presentation", () => {
  it("ranks only valid screening points and does not convert scores to probabilities", () => {
    const rows = rankedCandidates([
      { latitude: 39, longitude: -95, score_index: 1.1, valid_time: "2026-10-13T22:00:00Z" },
      { latitude: 38, longitude: -96, score_index: 1.47, valid_time: "2026-10-14T00:00:00Z" },
      { latitude: 400, longitude: -95, score_index: 99 },
    ])
    expect(rows.map((row) => row.score_index)).toEqual([1.47, 1.1])
    expect(rows.map((row) => row.rank)).toEqual([1, 2])
  })

  it("orders source timestamps without inventing a revision diff", () => {
    const entries = setupChronology({ first_seen_at: "2026-10-12T00:00:00Z", generated_at: "2026-10-13T03:00:00Z", official: { issued_at: "2026-10-13T01:00:00Z" }, model: { target_points: [{ run_time: "2026-10-13T02:00:00Z" }] } })
    expect(entries.map((entry) => entry.key)).toEqual(["first", "official", "model", "draft"])
  })
})
