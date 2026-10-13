import { describe, expect, it } from "vitest"
import { currentMediaTimestamp, isProgramMediaUrl } from "./programMonitorPolicy"
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
})
