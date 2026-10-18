import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PcPreparationResult } from "./PcPreparationResult"
import PreparePcControls from "./PreparePcControls"
import { preparationDisabledReason, type PcLauncher } from "./pcPreparation"
const doc:PcLauncher={online:false,host:"PHAENON3",observedAt:null,last:{requestId:"x",action:"prepare",state:"succeeded",createdAt:Date.parse("2026-10-15T23:00:00Z"),result:{pcReady:true,feedReady:true,outputsOff:true,facebookConfigured:true,youtubeConfigured:true}}}
describe("offline PC preparation",()=>{
 it("scopes READY and SUCCEEDED to grey last-known history",()=>{
  const html=renderToString(<PcPreparationResult doc={doc}/>).replaceAll("<!-- -->", "")
  expect(html).toContain('class="pc-prepare__last-known"')
  expect(html).toContain("Last known (")
  expect(html).toContain("current readiness unknown")
  expect(html).toContain("Last known prepare: SUCCEEDED")
  expect(html).toContain("Last known PC")
  expect(html).not.toContain("<b>READY</b>")
  expect(html).toContain("Previously ready")
  expect(html).not.toContain('aria-label="Last PC health check"')
 })
 it("shows a disabled reason on the offline card",()=>{
  expect(preparationDisabledReason(doc,false)).toContain("Helper offline")
  const html=renderToString(<PreparePcControls/>)
  expect(html).toContain('id="pc-prepare-disabled-reason"')
  expect(html).toContain("Helper offline / unknown")
  expect(html).toContain('disabled="">Prepare PC')
  expect(html).toContain('disabled="">Check PC only')
 })
})
