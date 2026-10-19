import { describe, expect, it } from "vitest"
import { currentMediaTimestamp, isProgramMediaUrl, currentProgramRender, mediaCompositionMatches, PROGRAM_PREVIEW_POLL_MS, PROGRAM_STATUS_POLL_MS } from "./programMonitorPolicy"
describe("PROGRAM monitor request policy", () => {
  const origin = "https://ops.codeblackwx.com"
  it("allows only authenticated same-origin playlist and segment routes", () => {
    expect(isProgramMediaUrl("/api/producer/v1/preview/hls/index.m3u8", origin)).toBe(true)
    expect(isProgramMediaUrl(`${origin}/api/producer/v1/preview/hls/program-${"a".repeat(32)}-123.ts`, origin)).toBe(true)
    for (const path of ["https://evil.test/api/producer/v1/preview/hls/index.m3u8", "/api/producer/v1/preview/hls/index.m3u8?token=secret", "/api/producer/v1/workstation/preview/hls/index.m3u8", "/api/producer/v1/preview/hls/../../status", "/api/producer/v1/preview/hls/key.bin"]) expect(isProgramMediaUrl(path, origin)).toBe(false)
  })
  it("rejects absent, stale and future freshness evidence", () => {
    const now = Date.now()
    expect(currentMediaTimestamp(new Date(now).toISOString(), now)).toBe(now)
    expect(currentMediaTimestamp(null, now)).toBeNull()
    expect(currentMediaTimestamp(new Date(now - 6000).toISOString(), now)).toBeNull()
    expect(currentMediaTimestamp(new Date(now + 5000).toISOString(), now)).toBeNull()
  })
  it("requires exact composition alignment when IDs are advertised, but supports legacy media", () => {
    const id="a".repeat(24)
    expect(mediaCompositionMatches(id,id)).toBe(true)
    for(const value of [null,"","b".repeat(24),"bad"])expect(mediaCompositionMatches(id,value)).toBe(false)
    expect(mediaCompositionMatches("bad","bad")).toBe(false)
    expect(mediaCompositionMatches(undefined,null)).toBe(true)
    expect(mediaCompositionMatches(undefined,id)).toBe(true)
  })
  it("allows OBS standby PROGRAM with no live camera, only while render proof is fresh", () => {
    const now=Date.now(), id="a".repeat(24)
    const status={engine:"obs",observedAt:new Date(now).toISOString(),source_state:"SOURCE_LOST",composition:{id},previews:{program:{state:"ACTIVE"}},program:{state:"RENDERING",compositionId:id,generation:"b".repeat(32),lastFrameAt:new Date(now).toISOString()}}
    expect(currentProgramRender(status,now)).toBe(true)
    expect(currentProgramRender(status,now+6000)).toBe(false)
    expect(currentProgramRender({...status,program:{...status.program,compositionId:"c".repeat(24)}},now)).toBe(false)
    expect(currentProgramRender({...status,program:{...status.program,generation:"bad"}},now)).toBe(false)
    expect(currentProgramRender({...status,previews:{program:{state:"OFF"}}},now)).toBe(false)
    expect(currentProgramRender({...status,program:undefined,source_state:"SOURCE_LIVE"},now)).toBe(false)
  })
  it("preserves legacy live-source eligibility without composition IDs", () => {
    expect(currentProgramRender({source_state:"SOURCE_LIVE",previews:{program:{state:"ACTIVE"}}})).toBe(true)
    expect(currentProgramRender({source_state:"SOURCE_LOST",previews:{program:{state:"ACTIVE"}}})).toBe(false)
  })
  it("keeps cached live render proof within its five-second budget between polls", () => {
    expect(PROGRAM_STATUS_POLL_MS).toBeLessThan(5000)
    expect(PROGRAM_PREVIEW_POLL_MS).toBeGreaterThan(PROGRAM_STATUS_POLL_MS)
    const now=Date.now(),id="a".repeat(24)
    const status={engine:"obs",observedAt:new Date(now-1000).toISOString(),composition:{id},previews:{program:{state:"ACTIVE"}},program:{state:"RENDERING",compositionId:id,generation:"b".repeat(32),lastFrameAt:new Date(now-1000).toISOString()}}
    expect(currentProgramRender(status,now+PROGRAM_STATUS_POLL_MS+500)).toBe(true)
    expect(currentProgramRender(status,now+4100)).toBe(false)
  })
})
