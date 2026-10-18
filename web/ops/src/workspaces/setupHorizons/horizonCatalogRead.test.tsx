import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { loadHorizonCatalog } from "./horizonCatalogRead"
import { HorizonCatalogView } from "./HorizonCatalog"
import { readOpsCoreConfig } from "../../core/config"
const mock=vi.hoisted(()=>({read:vi.fn()}))
vi.mock("../../core/client",()=>({fetchForecast:(...args:unknown[])=>mock.read(...args)}))
afterEach(()=>{vi.useRealTimers();mock.read.mockReset()})
describe("saved horizon catalog",()=>{
 it("ends a hung read within ten seconds and aborts its signal",async()=>{
  vi.useFakeTimers()
  mock.read.mockImplementation(()=>new Promise(()=>{}))
  const result=loadHorizonCatalog(readOpsCoreConfig({}))
  const assertion=expect(result).rejects.toMatchObject({name:"AbortError"})
  await vi.advanceTimersByTimeAsync(10_000)
  await assertion
  expect(mock.read.mock.calls[0][2].aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
 })
 it("shows the existing failure state without a perpetual loading message and leaves paths interactive",()=>{
  const html=renderToString(<HorizonCatalogView catalog={null} error="UNAVAILABLE" onRefresh={()=>{}}/>)
  expect(html).toContain("Saved-source refresh failed")
  expect(html).not.toContain("Loading saved official-source catalog")
  expect(html).toContain('role="group" aria-label="conus state boundaries')
  expect(html).not.toContain('role="img"')
 })
})
