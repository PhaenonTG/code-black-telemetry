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

describe("SON-2 Status Center minimum text", () => {
  it.each([
    ".page-header__kicker", ".page-action-link",
    ".status-center__overall>span", ".status-center__overall small",
    ".status-center__tile>span", ".status-center__tile p",
    ".status-center__panel>h2", ".status-center__telemetry>h2",
    ".status-center__facts span", ".status-center__facts b", ".status-center__muted",
    ".status-center__select", ".status-center__select select",
    ".status-center__attention span", ".status-center__attention b", ".status-center__attention p",
    ".status-center__telemetry article>span", ".status-center__telemetry p",
    ".status-center__summary .ops-status-badge", ".status-center__telemetry .ops-status-badge",
    ".status-center__admin>summary", ".settings-toggle-row__description", ".settings-save",
  ])("keeps %s at the shared 12px minimum in portrait and landscape", selector => {
    const rules = css.split("}").filter(rule => rule.includes("font-size:var(--cb-text-min,12px)"))
    expect(rules).toHaveLength(1)
    expect(rules[0]).toContain(".shell .page-status-center--brand :is(")
    const selectors = rules[0].split(":is(")[1].split("){")[0].split(",")
    expect(selectors).toContain(selector)
    const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8")
    expect(Number(tokens.match(/--cb-text-min:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(12)
  })
})
