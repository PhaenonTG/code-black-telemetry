import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LocationControl } from "./LocationControl"
const context = vi.hoisted(()=>({value:{} as Record<string,unknown>}))
vi.mock("../core/useCoreOps",()=>({useCoreOps:()=>context.value}))
afterEach(()=>vi.useRealTimers())
function render(overrides:Record<string,unknown> = {}) {
 context.value = {state:{fabric:{units:{units:[]}}},selectedPoint:null,locationMode:"follow",referenceUnitId:"striker",referenceLabel:"Pea Ridge",referenceIsFallback:true,referenceIsStale:false,referenceChaserFix:null,deviceLocation:{status:"unavailable"},...overrides}
 return renderToString(<LocationControl/>).replaceAll("<!-- -->", "")
}
describe("location reference explanation",()=>{
 it("shows the fallback reason and a location picker control",()=>{
  const html=render()
  expect(html).toContain("Using fallback location · no chaser GPS")
  expect(html).toContain("Choose location")
  expect(html).toContain('aria-label="OPS location reference"')
 })
 it("shows the age of an old verified chaser fix",()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T23:00:00Z"))
  const html=render({state:{fabric:{units:{units:[{unit_id:"striker",unit_type:"chase-platform",operator_name:"Spencer",overall_health:"OFFLINE",location:{observed_at:"2026-10-18T22:55:00Z"}}]}}}})
  expect(html).toContain("GPS unavailable - last fix 5m ago")
 })
 it("uses the retained context fix if a selected unit drops its location",()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T23:00:00Z"))
  expect(render({referenceChaserFix:{point:{lat:36,lon:-94},observedAt:Date.parse("2026-10-18T22:50:00Z")},state:{fabric:{units:{units:[{unit_id:"striker",unit_type:"chase-platform",operator_name:"Spencer",overall_health:"OFFLINE"}]}}}})).toContain("last fix 10m ago")
 })
 it("does not invent a last fix or show the fallback warning for GPS references",()=>{
  const html=render({referenceIsFallback:false,state:{fabric:{units:{units:[{unit_id:"striker",unit_type:"chase-platform",operator_name:"Spencer",overall_health:"OFFLINE"}]}}}})
  expect(html).toContain("GPS unavailable")
  expect(html).not.toContain("last fix")
  expect(html).not.toContain("Using fallback location")
 })
})

it("retains the last-fix age even when the selected chaser drops out of Fabric", () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T23:00:00Z"))
 expect(render({locationMode:"chaser",referenceChaserFix:{point:{lat:36,lon:-94},observedAt:Date.parse("2026-10-18T22:50:00Z")}})).toContain("GPS unavailable - last fix 10m ago")
})
