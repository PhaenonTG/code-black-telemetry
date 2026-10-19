// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const css = readFileSync(new URL("./StatusCenter.css", import.meta.url), "utf8")
const source = readFileSync(new URL("./StatusCenter.tsx", import.meta.url), "utf8")

function declarations(selector: string) {
  const rule = css.split("}").find(rule => rule.includes(`${selector}{`))
  expect(rule, `Missing scoped rule: ${selector}`).toBeDefined()
  return rule?.split("{").at(-1) ?? ""
}

describe("SON-1 Status Center tap targets", () => {
  it("gives radar review and workflow links real 44px boxes, including wrapped text", () => {
    const rule = declarations(".shell .page-status-center--brand :is(.status-center__facts a,.status-center__muted a,.page-action-link)")
    expect(rule).toContain("display:inline-flex")
    expect(rule).toContain("min-height:44px")
    expect(rule).toContain("min-width:44px")
    expect(rule).toContain("max-width:100%")
    expect(rule).toContain("overflow-wrap:anywhere")
    expect(source).toContain('className="status-center__facts"')
    expect(source).toContain('className="status-center__muted"')
    expect(source).toContain('href="/aegis-alerts">OPEN SHADOW SCANS</a>')
    expect(source).toContain('href="/automation-lab">Rehearse alert workflow</a>')
  })

  it("keeps the native admin disclosure and policy controls at least 44px high at every viewport", () => {
    for (const selector of [
      ".shell .page-status-center--brand .status-center__admin>summary",
      ".shell .page-status-center--brand :is(.status-center__select select,.settings-save)",
    ]) {
      const rule = declarations(selector)
      expect(rule).toContain("min-height:44px")
      expect(rule).toContain("box-sizing:border-box")
      expect(rule).toMatch(/padding:\d+px \d+px/)
    }
    expect(source).toContain('<details className="status-center__admin"><summary>Admin radar policy</summary>')
    expect(source).toContain('className="status-center__select"')
    expect(source).toContain('className="settings-save" disabled={saving}')
    // The disclosure retains its native marker and keyboard behavior.
    expect(declarations(".shell .page-status-center--brand .status-center__admin>summary")).not.toContain("display:")
  })
})
