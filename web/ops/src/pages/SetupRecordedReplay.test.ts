import { afterEach, describe, expect, it, vi } from "vitest"
import { recordedReplaySession } from "./SetupRecordedReplay"
import type { AegisStatus } from "../core/aegisFeed"
import { readOpsCoreConfig } from "../core/config"
const mocks = vi.hoisted(() => ({ replay: vi.fn() }))
vi.mock("../core/aegisFeed", () => ({ replayAegisPolicy: (...args: unknown[]) => mocks.replay(...args) }))
afterEach(() => { mocks.replay.mockReset(); vi.useRealTimers() })
describe("recorded scan page lifecycle", () => {
  it("loads once on open after first status, never on timers/cutoff, and once per explicit Refresh", async () => {
    vi.useFakeTimers()
    const result = { mode: "recorded", scans: [] }
    mocks.replay.mockResolvedValue(result)
    const receive = vi.fn()
    const page = recordedReplaySession(readOpsCoreConfig({}), new AbortController().signal, receive, vi.fn())
    expect(mocks.replay).not.toHaveBeenCalled()
    page.status({ screen: { cutoff: 85 } } as AegisStatus)
    await Promise.resolve()
    expect(mocks.replay).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.replay).toHaveBeenCalledTimes(1)
    page.status({ screen: { cutoff: 90 } } as AegisStatus)
    expect(mocks.replay).toHaveBeenCalledTimes(1)
    await page.refresh()
    expect(mocks.replay).toHaveBeenCalledTimes(2)
    expect(mocks.replay.mock.calls[1][1]).toEqual({ mode: "recorded", evidenceCutoff: 90, limit: 10 })
    await page.refresh()
    expect(mocks.replay).toHaveBeenCalledTimes(3)
    expect(receive).toHaveBeenCalledTimes(3)
  })
  it("aborts an in-flight replay on page leave and suppresses late results", async () => {
    let resolve!: (value: unknown) => void
    mocks.replay.mockImplementation(() => new Promise(done => { resolve = done }))
    const controller = new AbortController(), receive = vi.fn()
    const page = recordedReplaySession(readOpsCoreConfig({}), controller.signal, receive, vi.fn())
    page.status({ screen: {} } as AegisStatus)
    controller.abort()
    expect(mocks.replay.mock.calls[0][2].aborted).toBe(true)
    resolve({ mode: "recorded" }); await Promise.resolve()
    expect(receive).not.toHaveBeenCalled()
    await page.refresh(); expect(mocks.replay).toHaveBeenCalledTimes(1)
  })
})
