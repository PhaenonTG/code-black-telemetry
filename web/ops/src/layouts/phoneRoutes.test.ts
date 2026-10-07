import { describe, expect, it } from "vitest"
import { activePhoneRoute, PHONE_ROUTES } from "./phoneRoutes"

describe("phone navigation", () => {
  it.each(PHONE_ROUTES)("selects $label on its route", ({ path }) => {
    expect(activePhoneRoute(path)).toBe(path)
  })
  it.each(["/settings", "/weather", "/field", "/chase", "/soundings"])("keeps More selected on %s", (path) => {
    expect(activePhoneRoute(path)).toBe("/more")
  })
  it("does not confuse a route prefix with a child", () => {
    expect(activePhoneRoute("/radar-other")).toBe("/more")
  })
})
