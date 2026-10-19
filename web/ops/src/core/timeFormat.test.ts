import { afterEach, describe, expect, it, vi } from "vitest"
import { formatOpsTime, formatOpsTimestamp, formatOpsClock, timeZoneLabel } from "./timeFormat"
afterEach(() => vi.useRealTimers())
describe("Central time formatting", () => {
  it("derives CDT before the fall transition and CST after November 1", () => {
    expect(formatOpsTime("2026-10-31T15:30:00Z")).toBe("10:30 AM CDT")
    expect(formatOpsTime("2026-11-02T16:30:00Z")).toBe("10:30 AM CST")
    expect(timeZoneLabel("2026-11-02T16:30:00Z")).toBe("CST")
  })
  it("shows relative age after one hour without replacing local time", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-02T18:30:00Z"))
    expect(formatOpsTimestamp("2026-11-02T16:30:00Z")).toBe("10:30 AM CST · 2h ago")
    expect(formatOpsClock(new Date())).toBe("12:30 PM CST · 18:30Z")
  })
  it("does not invent a missing timestamp", () => expect(formatOpsTime("invalid")).toBe("—"))
})
