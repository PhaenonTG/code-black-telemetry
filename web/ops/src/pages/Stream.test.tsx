import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import Stream from "./Stream"
import { parseStreamHealth } from "../status/streamSources"
vi.mock("../core/useCoreOps",()=>({useCoreOps:()=>({config:{},state:{fabric:{units:null}}})}))
describe("Program Status source rows",()=>{
 it("renders known source rows without per-source backend fields",()=>{
  expect(parseStreamHealth({}).sources.map(source=>source.name)).toEqual(["Spencer","Nick","Producer PC"])
  const html=renderToString(<MemoryRouter><Stream/></MemoryRouter>)
  for(const name of ["Spencer","Nick","Producer PC"]) expect(html).toContain(`<strong>${name}</strong>`)
  expect(html.match(/<span>Unknown - no report<\/span>/g)).toHaveLength(3)
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
