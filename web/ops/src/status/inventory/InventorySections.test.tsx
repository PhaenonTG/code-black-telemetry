import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { InventorySections, type InventoryDocument } from "./InventorySections"
const project=(id:string,health:string)=>({id,name:id,health,phase:"Declared",deployment:"UNVERIFIED",serviceKeys:[],lifecycle:"RETAINED",source_present:true})
const document:InventoryDocument={schema:"codeblack.ops.inventory.v1",generated_at:"now",source_generated_at:null,source_revision:null,policy_revision:"1",freshness:"current",projects:[project("Unknown area","UNKNOWN"),project("Live area","LIVE"),project("Failed area","UNAVAILABLE")],hosts:[],services:[],links:[]}
describe("operational inventory areas",()=>{
 it("shows observed health first and retains unobserved areas in a closed keyboard disclosure",()=>{
  const html=renderToString(<InventorySections document={document} error={null}/>).replaceAll("<!-- -->", "")
  const disclosure=html.indexOf('<details class="ops-inventory__not-monitored">')
  expect(disclosure).toBeGreaterThan(html.indexOf("Live area"))
  expect(disclosure).toBeGreaterThan(html.indexOf("Failed area"))
  expect(disclosure).toBeLessThan(html.indexOf("Unknown area"))
  expect(html).toContain("<summary>Not monitored (1)</summary>")
  expect(html).not.toContain('ops-inventory__not-monitored" open')
 })
 it("does not add an empty disclosure for monitored areas",()=>{
  expect(renderToString(<InventorySections document={{...document,projects:[project("Live","LIVE")]}} error={null}/>)).not.toContain("Not monitored (")
 })
})
