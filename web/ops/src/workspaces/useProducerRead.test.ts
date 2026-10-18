import { afterEach, expect, it, vi } from "vitest"

// Node convention: capture React's effect lifecycle so the hook's actual
// unmount cleanup is exercised without adding a DOM dependency.
const lifecycle = vi.hoisted(() => ({ setup: undefined as (() => (() => void)) | undefined }))
vi.mock("react", () => ({
  useState: (initialize: () => unknown) => [initialize()],
  useEffect: (setup: () => (() => void)) => { lifecycle.setup = setup },
}))
import { useProducerRead } from "./useProducerRead"

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it("aborts the fetch on hook unmount and suppresses all late state callbacks", async () => {
  vi.useFakeTimers()
  let resolve!: (response: Response) => void
  const fetchMock = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(done => { resolve = done }))
  vi.stubGlobal("fetch", fetchMock)
  const read = useProducerRead(), success = vi.fn(), failure = vi.fn()
  const unmount = lifecycle.setup!()
  const running = read.run(signal => fetch("/api/producer/v1/status", { signal }), success, failure)
  unmount()
  expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true)
  resolve(new Response("{}"))
  await running
  expect(success).not.toHaveBeenCalled()
  expect(failure).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)

  // StrictMode can mount the effect again on the same hook instance.
  const cleanup = lifecycle.setup!()
  await read.run(async () => "fresh", success, failure)
  expect(success).toHaveBeenCalledWith("fresh")
  cleanup()
})
