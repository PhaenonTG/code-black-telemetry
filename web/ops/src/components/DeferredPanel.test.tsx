import { afterEach, expect, it, vi } from "vitest"
import { renderToString } from "react-dom/server"
import { readFileSync } from "node:fs"
import { DeferredPanel } from "./DeferredPanel"
import { deferPanel } from "./deferPanel"
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it("reserves space without rendering expensive children on the initial pass", () => {
  const Expensive = vi.fn(() => <div>Map</div>)
  const html = renderToString(<DeferredPanel title="Situation map" minHeight={260}>{<Expensive />}</DeferredPanel>)
  expect(html).toContain("min-height:260px")
  expect(html.replaceAll("<!-- -->", "")).toContain("Open Situation map")
  expect(Expensive).not.toHaveBeenCalled()
  expect(html).not.toContain(">Map<")
})
it("waits for intersection then idle and admits a panel once", async () => {
  vi.useFakeTimers()
  let intersect!: (entries: { isIntersecting: boolean }[]) => void
  const disconnect = vi.fn(), observe = vi.fn()
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof intersect) { intersect = callback }
    observe = observe; disconnect = disconnect
  })
  const reveal = vi.fn(), host = {} as Element, stop = deferPanel(host, reveal)
  expect(observe).toHaveBeenCalledWith(host)
  await vi.advanceTimersByTimeAsync(500); expect(reveal).not.toHaveBeenCalled()
  intersect([{ isIntersecting: false }]); intersect([{ isIntersecting: true }]); intersect([{ isIntersecting: true }])
  await vi.advanceTimersByTimeAsync(48); expect(reveal).toHaveBeenCalledOnce()
  stop(); expect(vi.getTimerCount()).toBe(0)
})
it("falls back without an observer and cancels deferred admission on unmount", async () => {
  vi.useFakeTimers(); vi.stubGlobal("IntersectionObserver", undefined)
  const reveal = vi.fn(), stop = deferPanel({} as Element, reveal)
  stop(); await vi.advanceTimersByTimeAsync(500); expect(reveal).not.toHaveBeenCalled()
  const cleanup = deferPanel({} as Element, reveal)
  await vi.advanceTimersByTimeAsync(48); expect(reveal).toHaveBeenCalledOnce(); cleanup()
})
it("keeps the producer map behind a lazy boundary without deferring its controls", () => {
  const source = readFileSync(new URL("../pages/ProducerWorkspace.tsx", import.meta.url), "utf8")
  expect(source).toContain('lazy(() => import("../workspaces/ProducerSituationMap")')
  expect(source).toContain('<DeferredPanel title="Situation map"')
  expect(source).toContain('<ProducerControls monitorRunning={monitorRunning} />')
  expect(source).toContain('<PreparePcControls />')
})
