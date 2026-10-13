import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import ProducerControls from "./ProducerControls"
import { compositionAligned, formatResolution, type NativeStatus } from "./broadcasterStatus"
import { mediaCompositionMatches } from "./programMonitorPolicy"

describe("Producer composition compatibility", () => {
  it("keeps no-ID legacy media usable but never aligns unknown or mismatched compositions", () => {
    const id = "a".repeat(24)
    expect(mediaCompositionMatches(undefined, null)).toBe(true)
    expect(mediaCompositionMatches(id, null)).toBe(false)
    expect(mediaCompositionMatches(id, "b".repeat(24))).toBe(false)
    expect(mediaCompositionMatches(id, id)).toBe(true)
    for (const invalid of ["", "../secret", "A".repeat(24), "a".repeat(25)]) expect(mediaCompositionMatches(undefined, invalid)).toBe(false)
    const status: NativeStatus = { stateRevision: 1, source_state: "SOURCE_LIVE", composition: { id }, previews: { program: { compositionId: id } }, monitor: { state: "CURRENT", compositionId: id } }
    expect(compositionAligned(status)).toBe(true)
    expect(compositionAligned({ ...status, monitor: { state: "CURRENT" } })).toBe(false)
    expect(compositionAligned({ ...status, monitor: { state: "CURRENT", compositionId: "b".repeat(24) } })).toBe(false)
    expect(compositionAligned({ ...status, source_state: "SOURCE_LOST" })).toBe(false)
  })
  it("does not invent an input resolution and wires readout and overlay editor into live controls", () => {
    expect(formatResolution(undefined)).toBe("Not reported")
    expect(formatResolution({ width: 1920, height: 1080, fps: 30 })).toBe("1920 × 1080 · 30 fps")
    const html = renderToStaticMarkup(createElement(ProducerControls))
    expect(html).toContain("Native broadcaster telemetry")
    expect(html).toContain("Overlay controls await current broadcaster settings")
    expect(html).toContain("Take control")
  })
})
