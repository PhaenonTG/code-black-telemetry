import {describe,it,expect} from "vitest"
import {canPrepare,preparationPending,STREAM_WORK,type PcLauncher} from "./pcPreparation"
const ready:PcLauncher={online:true,host:"PHAENON3",observedAt:new Date().toISOString(),controlAccess:{allowed:true}}
describe("remote PC preparation safety and work tracking",()=>{
 it("requires an online helper, approved account and no pending command",()=>{expect(canPrepare(ready,false)).toBe(true);expect(canPrepare(null,false)).toBe(false);expect(canPrepare({...ready,online:false},false)).toBe(false);expect(canPrepare({...ready,controlAccess:{allowed:false}},false)).toBe(false);expect(canPrepare(ready,true)).toBe(false);for(const state of ["queued","delivered","unknown"])expect(canPrepare({...ready,last:{requestId:"x",action:"prepare",state,createdAt:0}},false)).toBe(false);});
 it("tracks pending separately from completion",()=>{expect(preparationPending({...ready,last:{requestId:"x",action:"check",state:"delivered",createdAt:0}})).toBe(true);expect(preparationPending(ready)).toBe(false);});
 it("marks 360 as test-only, not qualified production",()=>{const work=STREAM_WORK.find(x=>x.id==="camera360")!;expect(work.state).toContain("TEST ONLY");expect(work.detail).toContain("Not a production camera");expect(work.state).not.toContain("DEPLOYED");});
});
