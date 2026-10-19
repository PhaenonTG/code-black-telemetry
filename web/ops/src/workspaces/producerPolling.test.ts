import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createProducerPoll, pollProducerCommand, PRODUCER_REQUEST_TIMEOUT_MS } from "./producerPolling"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe("producer request lifecycle", () => {
  it("deadlines a fetch that ignores abort and reports stale data", async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {}))
    vi.stubGlobal("fetch", fetchMock)
    const poll = createProducerPoll(), success = vi.fn(), failure = vi.fn()
    const running = poll.run(signal => fetch("/api/producer/v1/status", { signal }), success, failure)
    await vi.advanceTimersByTimeAsync(PRODUCER_REQUEST_TIMEOUT_MS)
    await running
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true)
    expect(failure.mock.calls[0][0].message).toMatch(/timed out.*stale/)
    expect(success).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("bounds token acquisition and prevents a fetch after late token resolution", async () => {
    const token = deferred<string>(), fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const poll = createProducerPoll(), failure = vi.fn()
    const running = poll.run(async signal => {
      await token.promise
      signal.throwIfAborted()
      return fetch("/api/producer/v1/status", { signal })
    }, vi.fn(), failure)
    await vi.advanceTimersByTimeAsync(PRODUCER_REQUEST_TIMEOUT_MS)
    await running
    token.resolve("test-token")
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(failure).toHaveBeenCalledOnce()
  })

  it("bounds response body decoding", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: () => new Promise(() => {}) }))
    const failure = vi.fn()
    const running = createProducerPoll().run(async signal => (await fetch("/api/producer/v1/status", { signal })).json(), vi.fn(), failure)
    await vi.advanceTimersByTimeAsync(PRODUCER_REQUEST_TIMEOUT_MS)
    await running
    expect(failure).toHaveBeenCalledOnce()
  })

  it("aborts a superseded request and ignores its late response", async () => {
    const old = deferred<string>(), values: string[] = [], signals: AbortSignal[] = []
    const poll = createProducerPoll(), failure = vi.fn()
    const first = poll.run(signal => { signals.push(signal); return old.promise }, value => values.push(value), failure)
    await poll.run(async () => "completed", value => values.push(value), failure)
    expect(signals[0].aborted).toBe(true)
    old.resolve("queued")
    await first
    expect(values).toEqual(["completed"])
    expect(failure).not.toHaveBeenCalled()
  })
})

describe("command result polling", () => {
  it("does not start a second request while the first is pending; schedules after settlement", async () => {
    const pending = deferred<string>()
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue("completed"))
    const receive = vi.fn()
    const stop = pollProducerCommand(signal => fetch("/api/producer/v1/commands/test", { signal }), value => String(value) === "completed", receive, () => false)
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(4500)
    expect(fetch).toHaveBeenCalledTimes(1)
    pending.resolve("queued")
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1499)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    stop()
  })

  it.each(["completed", "failed", "rejected", "expired", "unknown"])("keeps %s when an older timed-out response arrives out of order", async terminal => {
    const old = deferred<string>(), read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(terminal)
    const values: string[] = []
    const stop = pollProducerCommand<string>(read, value => value !== "queued", value => values.push(value), () => false)
    await vi.advanceTimersByTimeAsync(1500 + PRODUCER_REQUEST_TIMEOUT_MS + 1500)
    expect(values).toEqual([terminal])
    old.resolve("queued")
    await vi.advanceTimersByTimeAsync(30_000)
    expect(values).toEqual([terminal])
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[0][0].aborted).toBe(true)
    stop()
  })

  it("aborts on cleanup without scheduling another command request or committing state", async () => {
    const pending = deferred<string>(), receive = vi.fn(), failure = vi.fn(() => false)
    const read = vi.fn((_signal: AbortSignal) => pending.promise)
    const stop = pollProducerCommand(read, value => value !== "queued", receive, failure)
    await vi.advanceTimersByTimeAsync(1500)
    stop()
    expect(read.mock.calls[0][0].aborted).toBe(true)
    pending.resolve("completed")
    await vi.advanceTimersByTimeAsync(30_000)
    expect(receive).not.toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
