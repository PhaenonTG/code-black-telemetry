import { afterEach, describe, expect, it, vi } from "vitest"
import { requestDeadline } from "./requestDeadline"
afterEach(() => vi.useRealTimers())
describe("request deadlines", () => {
 it("does not start an already-cancelled read", async () => {
  const controller = new AbortController()
  controller.abort()
  const read = vi.fn()
  await expect(requestDeadline(read, 10_000, controller.signal)).rejects.toMatchObject({name:"AbortError"})
  expect(read).not.toHaveBeenCalled()
 })
 it("cancels a hung transport and removes its timer when the caller leaves", async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  let signal: AbortSignal | undefined
  const result = requestDeadline(inner => { signal = inner; return new Promise(() => {}) }, 10_000, controller.signal)
  const assertion = expect(result).rejects.toMatchObject({name:"AbortError"})
  controller.abort()
  await assertion
  expect(signal?.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
 })
})
