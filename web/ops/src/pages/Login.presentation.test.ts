// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const css = readFileSync(new URL("../styles/auth.css", import.meta.url), "utf8")
const mobile = readFileSync(new URL("../styles/mobile.css", import.meta.url), "utf8")
const page = (name: string) => readFileSync(new URL(`./${name}.tsx`, import.meta.url), "utf8")
function rule(selector: string) {
  const block = css.split("}").find(block => block.includes(`${selector}{`))
  expect(block, `Missing auth rule ${selector}`).toBeDefined()
  return block?.split("{").at(-1) ?? ""
}

describe("V-7 auth text minimum", () => {
  it("keeps the kicker, subtitle, links and session tagline at least 12px", () => {
    for (const selector of [".auth-card__kicker", ".auth-card__subtitle", ".auth-card__link", ".auth-screen .auth-screen__status"]) {
      expect(rule(selector)).toContain("font-size:12px")
    }
    // The session status selector outranks mobile.css's later 10px rule.
    expect(mobile).toContain(".auth-screen__status { flex-shrink: 0; margin-bottom: auto; font-size: 10px; }")
  })
})

describe("RIP-14 recovery card centering", () => {
  it("balances both card margins without depending on a status sibling", () => {
    expect(page("UpdatePassword")).toContain('className="auth-screen auth-screen--recovery"')
    expect(rule(".auth-screen--recovery .auth-card")).toContain("margin-block:auto")
    expect(page("UpdatePassword")).toContain('phase === "invalid-link"')
    expect(page("UpdatePassword")).toContain('phase === "done"')
  })
})

describe("RIP-15 unauthorized card centering", () => {
  it("balances the standalone account card and retains sign out", () => {
    expect(page("Unauthorized")).toContain('className="auth-screen auth-screen--unauthorized"')
    expect(rule(".auth-screen--unauthorized .auth-card")).toContain("margin-block:auto")
    expect(page("Unauthorized")).toContain('onClick={() => void signOut()}')
  })
})

describe("RIP-16 landscape auth scrolling", () => {
  it("uses safe centering and scroll overflow at every width", () => {
    const screen = rule(".auth-screen")
    expect(screen).toContain("justify-content:safe center")
    expect(screen).toContain("overflow-y:auto")
    expect(screen).toContain("box-sizing:border-box")
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(screen).toContain(`env(safe-area-inset-${edge}, 0px)`)
    }
    expect(rule(".auth-card")).toContain("flex-shrink:0")
    expect(rule(".auth-screen .auth-screen__status")).toContain("flex-shrink:0")
    expect(css.indexOf("overflow-y:auto")).toBeLessThan(css.indexOf("@media"))
  })
})

describe("RIP-17 recovery link height", () => {
  it("gives both button and anchor recovery actions a centered 44px box at all widths", () => {
    const link = rule(".auth-card__link")
    for (const declaration of ["display:inline-flex", "align-items:center", "justify-content:center", "min-height:44px", "box-sizing:border-box"]) {
      expect(link).toContain(declaration)
    }
    expect(page("Login")).toContain('className="auth-card__link" onClick={onBack}')
    expect(page("UpdatePassword")).toContain('<Link to="/" className="auth-card__link">')
  })
})

describe("RIP-18 recovery link width", () => {
  it("adds horizontal hit-area padding and a minimum width to text links", () => {
    const link = rule(".auth-card__link")
    expect(link).toContain("min-width:44px")
    expect(link).toContain("padding:4px 12px")
    expect(link).toContain("max-width:100%")
  })
})

describe("RIP-19 auth keyboard focus", () => {
  it("adds an offset, high contrast input outline separate from the red error border", () => {
    const focus = rule(".auth-field input:focus-visible")
    expect(focus).toContain("outline:2px solid var(--cb-text)")
    expect(focus).toContain("outline-offset:2px")
    expect(css.indexOf("input:focus-visible")).toBeGreaterThan(css.indexOf("input:focus{"))
  })
})
