import { describe, expect, it } from "vitest"
import { setupQueueRevision } from "./setupQueueRevision"

describe("setup queue revision", () => {
  const row = { setup_id: "selected", revision: 8 }
  it("shows the newer current revision already loaded in the detail", () => {
    expect(setupQueueRevision(row, { ...row, revision: 9 })).toBe(9)
  })
  it("never relabels the current queue as a historical or different setup", () => {
    expect(setupQueueRevision(row, { ...row, revision: 7, is_current_revision: false })).toBe(8)
    expect(setupQueueRevision(row, { setup_id: "other", revision: 12 })).toBe(8)
    expect(setupQueueRevision(row, null)).toBe(8)
  })
  it("does not regress a newer index revision", () => {
    expect(setupQueueRevision(row, { ...row, revision: 7 })).toBe(8)
  })
})
