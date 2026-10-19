import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import Stream, { SourcesContent } from "./Stream"
import { parseStreamHealth } from "../status/streamSources"
vi.mock("../core/useCoreOps",()=>({useCoreOps:()=>({config:{},state:{fabric:{units:null}}})}))
describe("Program Status source rows",()=>{
 it("renders known source rows without per-source backend fields",()=>{
  expect(parseStreamHealth({}).sources.map(source=>source.name)).toEqual(["Spencer","Nick","Producer PC"])
  const html=renderToString(<MemoryRouter><Stream/></MemoryRouter>)
  for(const name of ["Spencer","Nick","Producer PC"]) expect(html).toContain(`<strong>${name}</strong>`)
  expect(html.match(/>Waiting<\/span>/g)).toHaveLength(3)
 })
 it("uses known last-seen times without interpreting presence as publishing",()=>{
  const source=parseStreamHealth(null,[{unit_id:"striker",display_name:"STRIKER",operator_name:"Spencer",last_seen:"2026-10-18T23:00:00Z"}]).sources[0]
  expect(source.lastSeen).toBeTruthy()
  expect(source.publisher_online).toBeUndefined()
 })
 it("preserves reported sources and infrastructure fields",()=>{
  expect(parseStreamHealth({sources:[{id:"x",name:"Live camera",publisher_online:true,readers:3}],ingest:{srt:{state:"LIVE"}}})).toMatchObject({sources:[{name:"Live camera",publisher_online:true}],ingest:{srt:{state:"LIVE"}}})
 })
})

it("matches established unit IDs when operator names are absent", () => {
 const sources=parseStreamHealth(null,[{unit_id:"cbwx-unit-striker",display_name:"STRIKER",last_seen:1792364400},{unit_id:"cbwx-unit-tessa",display_name:"TESSA",last_seen:1792364400}]).sources
 expect(sources[0].lastSeen).toBeTruthy()
 expect(sources[1].lastSeen).toBeTruthy()
 expect(sources.every(source=>source.publisher_online===undefined)).toBe(true)
})

describe("Producer Sources carry-over", () => {
 it("keeps every reported source, transport, reason, viewers and private monitor link", () => {
  const health = parseStreamHealth({ summary: "Private ingest summary", sources: [
   { id: "srt", name: "SRT field", publisher_online: true, readers: 0 },
   { id: "webrtc", name: "WebRTC field", publisher_online: false, reason: "Publisher disconnected" },
   { id: "pc", name: "Producer PC", lastSeen: "2026-11-02T16:30:00Z" },
  ], ingest: { srt: { state: "LIVE" }, webrtc: { state: "OFFLINE" } }, broadcast: { state: "DEGRADED" } })
  const html = renderToString(<MemoryRouter><SourcesContent health={health} error={null} units={[]} onRefresh={() => {}} /></MemoryRouter>)
  for (const text of ["Live Source Status", "SRT field", "WebRTC field", "Producer PC", "0 viewer(s)", "Publisher disconnected", "10:30 AM CST", "Private ingest summary", "Facebook availability", "Stale", "Offline field sources are informational", "Open private PROGRAM monitor", "Control", "Sources"]) expect(html).toContain(text)
  expect(html.indexOf("Live Source Status")).toBeLessThan(html.indexOf("Open private PROGRAM monitor"))
  expect(html.match(/<button/g)).toHaveLength(1)
  expect(html).toContain(">Refresh</button>")
 })
 it("keeps fallback units when telemetry fails and places raw errors behind Details", () => {
  const html = renderToString(<MemoryRouter><SourcesContent health={null} error="Failed to fetch" units={[{ unit_id: "striker", display_name: "STRIKER", last_seen: "2026-11-02T16:30:00Z" }]} onRefresh={() => {}} /></MemoryRouter>)
  expect(html).toContain("10:30 AM CST")
  expect(html).toContain("Waiting")
  expect(html).toContain("<details><summary>Details</summary><pre>Failed to fetch</pre></details>")
  expect(html).toContain(">Retry</button>")
 })
})
