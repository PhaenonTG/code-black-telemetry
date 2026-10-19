import { afterEach, expect, it, vi } from "vitest"
import { afterPaintIdle } from "./afterPaintIdle"
// @ts-expect-error Existing JavaScript poller has no declaration file.
import { visibleSnapshotPoller } from "./visibleSnapshotPoller.mjs"
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it("yields a frame and an idle slot, and cancels idle work on cleanup", () => {
  vi.useFakeTimers()
  let frame!: FrameRequestCallback, idle!: IdleRequestCallback
  const cancel = vi.fn()
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => { idle = callback; return 2 })
  vi.stubGlobal("cancelIdleCallback", cancel)
  const run = vi.fn(), stop = afterPaintIdle(run)
  expect(run).not.toHaveBeenCalled()
  frame(0); expect(run).not.toHaveBeenCalled()
  stop(); idle({} as IdleDeadline)
  expect(cancel).toHaveBeenCalledWith(2); expect(run).not.toHaveBeenCalled()
})
it("defers the first snapshot with timer fallback, pauses hidden work and resumes once", async () => {
  vi.useFakeTimers()
  const visibility = Object.assign(new EventTarget(), { hidden: false })
  const load = vi.fn().mockResolvedValue("snapshot"), onData = vi.fn()
  const poll = visibleSnapshotPoller({ visibility, load, onData, onError: vi.fn(), intervalMs: 100 })
  expect(load).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(47); expect(load).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1); expect(onData).toHaveBeenCalledWith("snapshot")
  visibility.hidden = true; visibility.dispatchEvent(new Event("visibilitychange"))
  await vi.advanceTimersByTimeAsync(500); expect(load).toHaveBeenCalledOnce()
  visibility.hidden = false; visibility.dispatchEvent(new Event("visibilitychange"))
  await vi.advanceTimersByTimeAsync(0); expect(load).toHaveBeenCalledTimes(2)
  poll.stop(); expect(vi.getTimerCount()).toBe(0)
})
it("cancels startup before a hidden document or unmount can start a snapshot", async () => {
  vi.useFakeTimers()
  const visibility = Object.assign(new EventTarget(), { hidden: false }), load = vi.fn()
  const poll = visibleSnapshotPoller({ visibility, load, onData: vi.fn(), onError: vi.fn() })
  visibility.hidden = true; visibility.dispatchEvent(new Event("visibilitychange"))
  await vi.advanceTimersByTimeAsync(500); expect(load).not.toHaveBeenCalled()
  poll.stop(); expect(vi.getTimerCount()).toBe(0)
})

it("defers the first visible read when the document started hidden", async () => {
  vi.useFakeTimers()
  const visibility = Object.assign(new EventTarget(), { hidden: true })
  const load = vi.fn().mockResolvedValue("snapshot")
  const poll = visibleSnapshotPoller({ visibility, load, onData: vi.fn(), onError: vi.fn() })
  await vi.advanceTimersByTimeAsync(500); expect(load).not.toHaveBeenCalled()
  visibility.hidden = false; visibility.dispatchEvent(new Event("visibilitychange"))
  expect(load).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(48); expect(load).toHaveBeenCalledOnce()
  poll.stop()
})
