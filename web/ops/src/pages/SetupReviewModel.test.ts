import { afterEach, describe, expect, it, vi } from "vitest"
import { analysisDestination, decisionInQueue, nextPotentialFrame, readSetupDecisions, setupLanding } from "./SetupReviewModel"
import { surveillanceDetails } from "./SetupSurveillanceRead"
import { readOpsCoreConfig } from "../core/config"
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock("../core/client", () => ({ fetchForecast: (...args: unknown[]) => mocks.read(...args) }))
const config = readOpsCoreConfig({})
afterEach(() => { mocks.read.mockReset(); vi.useRealTimers() })

describe("Setup Review routing and reads", () => {
  it.each([
    ["/analysis", "", "/setup-review"],
    ["/analysis", "?mode=today", "/setup-review/today?mode=today"],
    ...["today", "potential", "drafts", "briefings", "surveillance"].map(tab => [`/analysis/${tab}`, "?x=1", `/setup-review/${tab}?x=1`]),
    ["/analysis/horizons", "?day=2", "/setup-review/outlook?day=2"],
    ["/analysis/drafts/setup-20261019-0123456789", "?revision=2&x=1", "/setup-review/drafts/setup-20261019-0123456789?revision=2&x=1"],
    ["/analysis/briefings/setup-20261019-0123456789", "?revision=3&x=1", "/setup-review/briefings/setup-20261019-0123456789?revision=3&x=1"],
    ["/analysis/setup/setup-20261019-0123456789", "?revision=4", "/setup-review/drafts/setup-20261019-0123456789?revision=4"],
  ])("redirects %s and preserves its query", (path, search, destination) => {
    expect(analysisDestination(path, search)).toBe(destination)
  })
  it("defaults to Outlook without a verified approved current Day 1 briefing", async () => {
    mocks.read.mockResolvedValue({ items: [] })
    expect(await setupLanding(config, new AbortController().signal)).toBe("outlook")
  })
  it("opens Today only for an approved current Day 1 briefing valid now", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T17:00:00Z"))
    mocks.read.mockResolvedValueOnce({ items: [{ setup_id: "one", day: 1 }] }).mockResolvedValueOnce({
      setup_id: "one", official: { day: 1 }, workflow: { decision: { decision: "approved" } },
      valid_from: "2026-10-19T12:00:00Z", valid_until: "2026-10-20T12:00:00Z", generated_at: "2026-10-19T16:00:00Z",
    })
    expect(await setupLanding(config, new AbortController().signal)).toBe("today")
  })
  it("bounds a hung landing read and falls back without inferring approval", async () => {
    vi.useFakeTimers(); mocks.read.mockImplementation(() => new Promise(() => {}))
    const result = setupLanding(config, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await result).toBe("outlook")
    expect(mocks.read.mock.calls[0][2].aborted).toBe(true)
  })
  it("never files a failed/unknown decision under Drafts or Briefings", () => {
    expect(decisionInQueue(undefined, "drafts")).toBe(false)
    expect(decisionInQueue(undefined, "briefings")).toBe(false)
    expect(decisionInQueue(null, "drafts")).toBe(true)
    expect(decisionInQueue("approved", "briefings")).toBe(true)
    expect(decisionInQueue("approved", "drafts")).toBe(false)
  })
  it("keeps a failed decision unknown and can recover it on Retry", async () => {
    mocks.read.mockRejectedValueOnce(new Error("Failed to fetch"))
    const rows = [{ setup_id: "one" }], signal = new AbortController().signal
    const first = Object.fromEntries(await readSetupDecisions(config, rows, signal))
    expect(first).toHaveProperty("one", undefined)
    for (const queue of ["drafts", "briefings"] as const) expect(decisionInQueue(first.one, queue)).toBe(false)
    mocks.read.mockResolvedValueOnce({ workflow: { decision: { decision: "approved" } } })
    const retried = Object.fromEntries(await readSetupDecisions(config, rows, signal))
    expect(decisionInQueue(retried.one, "briefings")).toBe(true)
    expect(decisionInQueue(retried.one, "drafts")).toBe(false)
  })
  it("selects the next whole valid hour at or after now, including an exact hour", () => {
    const frames = [16, 17, 18].map(hour => ({ frame_id: String(hour), valid_time: `2026-10-19T${hour}:00:00Z`, run_time: "", forecast_hour: hour }))
    expect(nextPotentialFrame(frames, Date.parse("2026-10-19T16:30:00Z"))?.frame_id).toBe("17")
    expect(nextPotentialFrame(frames, Date.parse("2026-10-19T17:00:00Z"))?.frame_id).toBe("17")
    expect(nextPotentialFrame(frames, Date.parse("2026-10-19T19:00:00Z"))).toBeUndefined()
  })
  it("retains successful corridor evidence and marks only the failed row Unavailable", async () => {
    const rows = ["one", "two"].map(setup_id => ({ setup_id, day: 1, risk_label: "Marginal", revision: 1, valid_until: "" }))
    mocks.read.mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce({ ...rows[1], weighted_synthesis: null })
    const signal = new AbortController().signal
    const result = await surveillanceDetails(config, rows, signal)
    expect(result[0]).toEqual({ ...rows[0], unavailable: true })
    expect(result[1]).toEqual({ ...rows[1], weighted_synthesis: null })
    expect(mocks.read.mock.calls.every(call => call[2] === signal)).toBe(true)
  })
})
