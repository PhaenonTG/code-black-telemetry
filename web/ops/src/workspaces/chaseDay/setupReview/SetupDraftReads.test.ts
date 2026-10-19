import { afterEach, expect, it, vi } from "vitest"
import { fetchForecast } from "../../../core/client"
import { readOpsCoreConfig } from "../../../core/config"
import { readSetupDecisions } from "./SetupReviewModel"

// Exercise the existing client deadline, rather than replacing it with a mocked client.
vi.mock("../../../lib/supabase", () => ({ supabase: null }))
let sequence = 0
function config() {
  return readOpsCoreConfig({ VITE_CODEBLACK_CORE_BASE_URL: `https://drafts-${++sequence}.invalid` })
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it("settles a hung Drafts index read after 25 seconds even when fetch ignores abort", async () => {
  vi.useFakeTimers()
  const read = vi.fn(() => new Promise<Response>(() => {}))
  vi.stubGlobal("fetch", read)
  const result = fetchForecast(config(), "chase-setups", new AbortController().signal)
  const assertion = expect(result).rejects.toThrow("request timeout")
  await vi.advanceTimersByTimeAsync(25_000)
  await assertion
  expect(read).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it("settles hung decision reads as unknown and recovers them on retry", async () => {
  vi.useFakeTimers()
  const read = vi.fn(() => new Promise<Response>(() => {}))
  vi.stubGlobal("fetch", read)
  const source = config(), rows = [{ setup_id: "one" }], signal = new AbortController().signal
  const first = readSetupDecisions(source, rows, signal)
  await vi.advanceTimersByTimeAsync(25_000)
  expect(await first).toEqual([["one", undefined]])
  read.mockResolvedValue(new Response(JSON.stringify({ workflow: { decision: null } })))
  expect(await readSetupDecisions(source, rows, signal)).toEqual([["one", null]])
  expect(read).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

it("settles successful, empty, and failed index reads without retaining a deadline timer", async () => {
  vi.useFakeTimers()
  const read = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ready", items: [{ setup_id: "one" }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ready", items: [] })))
    .mockRejectedValueOnce(new Error("offline"))
  vi.stubGlobal("fetch", read)
  expect(await fetchForecast(config(), "chase-setups")).toEqual({ status: "ready", items: [{ setup_id: "one" }] })
  expect(await fetchForecast(config(), "chase-setups")).toEqual({ status: "ready", items: [] })
  await expect(fetchForecast(config(), "chase-setups")).rejects.toThrow("offline")
  expect(vi.getTimerCount()).toBe(0)
})
