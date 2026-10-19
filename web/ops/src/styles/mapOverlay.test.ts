import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const css = readFileSync(new URL("./pages.css", import.meta.url), "utf8")
const compact = css.match(/@media \(max-width:767px\), \(max-height:500px\)\{([^]*?)\n\}/)?.[1] ?? ""

describe("operations map overlay clearance", () => {
  it("keeps compact overlay rules available to narrow phones and short landscape screens", () => {
    expect(compact).toContain(".ops-map-overlay{left:12px;right:100px;")
    expect(compact).toContain(".ops-map-overlay>div{min-width:0;width:max-content;max-width:100%;")
    expect(compact).toContain(".ops-map-overlay .ops-pill,.ops-nearby-reference,.ops-voice-toggle{display:none}")
  })

  it("reserves the controls column on tablets while retaining left-side status clearance", () => {
    const overlay = css.match(/^\.ops-map-overlay\{([^}]+)\}/m)?.[1] ?? ""
    expect(overlay).toContain("right:100px;")
    expect(overlay).toContain("max-width:calc(100% - 282px)")
    expect(overlay).toContain("pointer-events:none;")
    expect(overlay).toContain("flex-wrap:wrap;")
  })

  it("limits the landscape extension to overlays, preserving workstation and map geometry", () => {
    const selectors = [...compact.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim())
    expect(selectors).toHaveLength(5)
    for (const selector of selectors) expect(selector).toMatch(/^\.ops-map-overlay(?:[ >.]|$)/)
    expect(compact).not.toContain(".ops-map-stage")
    expect(compact).not.toContain(".ops-workstation")
  })
})
