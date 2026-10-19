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
