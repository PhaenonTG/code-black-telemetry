import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { afterEach, expect, it, vi } from "vitest"
import HurricaneWatch from "./HurricaneWatch"
const mocks = vi.hoisted(() => ({ config: {}, effects: [] as Array<() => void | (() => void)>, fetch: vi.fn() }))
vi.mock("react", async original => {
  const react = await original<typeof import("react")>()
  return { ...react, useEffect: (effect: () => void | (() => void)) => mocks.effects.push(effect) }
})
vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => ({ config: mocks.config }) }))
vi.mock("../core/client", () => ({ fetchForecast: mocks.fetch }))
afterEach(() => { mocks.effects = []; mocks.config = {}; vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })
function renderWatch() {
  mocks.effects = []
  const html = renderToString(<MemoryRouter><HurricaneWatch /></MemoryRouter>)
  return { html, start: () => mocks.effects[2]() as () => void }
}
it("shows the last successful assessment immediately on revisit and retains it after failed/pending refreshes", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("window", globalThis)
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }))
  const snapshot = { status: "inactive", checked_at: "2026-10-19T20:00:00Z" }
  mocks.fetch.mockResolvedValueOnce(snapshot)
  const first = renderWatch()
  expect(first.html).toContain("Loading the latest assessment")
  const stop = first.start()
  expect(mocks.fetch).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(48)
  expect(mocks.fetch).toHaveBeenCalledOnce(); stop()
  for (const response of [Promise.reject(new Error("offline")), Promise.resolve({ status: "pending" })]) {
    // Install a handler immediately so the rejected response is never unhandled.
    response.catch(() => {})
    mocks.fetch.mockReturnValueOnce(response)
    const revisit = renderWatch()
    expect(revisit.html).toContain("Cached assessment")
    expect(revisit.html).not.toContain("Loading the latest assessment")
    expect(revisit.html).toContain("No active storms")
    const stopRevisit = revisit.start()
    await vi.advanceTimersByTimeAsync(48); stopRevisit()
    expect(renderWatch().html).toContain("Cached assessment")
  }
  expect(vi.getTimerCount()).toBe(0)
})
it("does not start assessment reads while hidden and resumes on visibility", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("window", globalThis)
  const doc = Object.assign(new EventTarget(), { hidden: true })
  vi.stubGlobal("document", doc)
  mocks.fetch.mockResolvedValue({ status: "inactive" })
  const stop = renderWatch().start()
  await vi.advanceTimersByTimeAsync(120000)
  expect(mocks.fetch).not.toHaveBeenCalled()
  doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange"))
  await vi.advanceTimersByTimeAsync(0); expect(mocks.fetch).toHaveBeenCalledOnce()
  stop(); expect(vi.getTimerCount()).toBe(0)
})
