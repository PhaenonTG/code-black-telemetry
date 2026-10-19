import { describe, expect, it } from "vitest"
import { outputStartReason, type ObsOutputStatus } from "./obsOutputPolicy"
const ready = (): ObsOutputStatus => ({engine:"obs",source_state:"SOURCE_LIVE",composition:{id:"a".repeat(24)},program:{state:"RENDERING"},audio:{available:true,state:"SIGNAL"},outputs:{facebook:{configured:true,state:"OFF"},youtube:{configured:true,state:"OFF"}},capabilities:{actions:{outputs:["facebook.start","youtube.start"]}}})
describe("OBS destination start policy", () => {
  it("requires the operator lease and rejects old broadcaster status", () => {
    expect(outputStartReason(ready(),"facebook",false)).toMatch(/Take control/)
    expect(outputStartReason(undefined,"facebook",true)).toMatch(/unavailable/)
    expect(outputStartReason(ready(),"facebook",true)).toBeNull()
  })
  it("requires live video, measured audio, and composition", () => {
    for (const status of [{...ready(),source_state:"SOURCE_LOST"},{...ready(),audio:{available:true,state:"CLIPPING"}},{...ready(),composition:{id:"bad"}}]) expect(outputStartReason(status,"facebook",true)).not.toBeNull()
  })
  it("keeps YouTube off until key, primary encoder and native capability are qualified", () => {
    const s=ready();s.outputs!.youtube!.configured=false
    expect(outputStartReason(s,"youtube",true)).toMatch(/activation\/key/)
    s.outputs!.youtube!.configured=true
    expect(outputStartReason(s,"youtube",true)).toMatch(/Facebook first/)
    s.outputs!.facebook!.state="SENDING"
    expect(outputStartReason(s,"youtube",true)).toBeNull()
    s.capabilities!.actions!.outputs=[]
    expect(outputStartReason(s,"youtube",true)).toMatch(/adapter/)
  })
})
