import { describe, expect, it } from "vitest"
import { ROUTES } from "../app/routes"
import { activePhoneRoute, isMoreDestination, MORE_SECTIONS, NAV_SECTION_LABELS, NAV_SECTIONS, navDetail, navLabel, PHONE_ROUTES } from "./phoneRoutes"

describe("phone navigation", () => {
  it.each(PHONE_ROUTES)("selects $label on its route", ({ path }) => {
    expect(activePhoneRoute(path)).toBe(path)
  })
  it.each(["/settings", "/weather", "/field", "/chase", "/soundings", "/workspace/chase", "/analysis", "/producer"])("keeps More selected on %s", (path) => {
    expect(activePhoneRoute(path)).toBe("/more")
  })
  it("does not confuse a route prefix with a child", () => {
    expect(activePhoneRoute("/radar-other")).not.toBe("/radar")
    expect(activePhoneRoute("/radar-other")).toBe("")
  })
})

describe("RIP-12 unmatched routes", () => {
  it.each(["/zz-bogus-route", "/no-such-page", "/radar-other"])("leaves no bottom-nav tab active on %s", (path) => {
    expect(activePhoneRoute(path)).toBe("")
  })
  it.each(["/settings", "/weather", "/field", "/soundings", "/producer", "/hurricane", "/directory"])("keeps More selected on known More child %s", (path) => {
    expect(activePhoneRoute(path)).toBe("/more")
  })
  it("still lights Status for coordination children", () => {
    expect(activePhoneRoute("/coordination")).toBe("/status")
    expect(activePhoneRoute("/coordination/session")).toBe("/status")
  })
})

describe("More / sidebar navigation parity", () => {
  const morePaths = MORE_SECTIONS.flatMap((group) => group.routes.map((route) => route.path))

  it("lists the workspaces on phone More (Chase Desk, Setup Review, Producer)", () => {
    const workspaces = MORE_SECTIONS.find((group) => group.section === "OPERATE")
    expect(workspaces?.routes.map((route) => route.path).sort()).toEqual(["/field", "/producer"])
    expect(workspaces?.routes.map((route) => route.label)).toContain("Producer")
  })

  it("only links existing routes, without duplicates", () => {
    const known = new Set(ROUTES.map((route) => route.path))
    expect(morePaths.every((path) => known.has(path))).toBe(true)
    expect(new Set(morePaths).size).toBe(morePaths.length)
  })

  it("mirrors every live sidebar destination that is not already in the bottom bar", () => {
    const bottom = new Set(PHONE_ROUTES.map((route) => route.path))
    const expected = ROUTES.filter((route) => route.inSidebar && !bottom.has(route.path)).map((route) => route.path)
    expect(morePaths.sort()).toEqual(expected.sort())
  })

  it("never repeats bottom-bar destinations or development placeholders", () => {
    for (const path of ["/", "/radar", "/chase-desk", "/status", "/ai", "/more"]) expect(morePaths).not.toContain(path)
    for (const path of ["/models", "/consensus", "/targets"]) expect(morePaths).not.toContain(path)
    expect(ROUTES.filter((route) => route.state === "DEVELOPMENT" && !route.inSidebar).some(isMoreDestination)).toBe(false)
  })

  it("does not duplicate System health in More because the SYSTEM tab opens it", () => {
    // /system is in the bottom bar as SYSTEM, so it is not duplicated in More.
    expect(morePaths).not.toContain("/system")
    expect(PHONE_ROUTES.find((route) => route.path === "/status")?.title).toBe("Status")
  })

  it("uses section headings that do not repeat an item label", () => {
    for (const section of NAV_SECTIONS) expect(NAV_SECTION_LABELS[section]).toBeTruthy()
    expect(navLabel({ path: "/system", label: "SYSTEM" })).toBe("SYSTEM")
  })

  it("keeps canonical labels for routes without a display override", () => {
    expect(navLabel({ path: "/analysis", label: "SETUP REVIEW" })).toBe("SETUP REVIEW")
    expect(navLabel({ path: "/field", label: "FIELD MAP" })).toBe("FIELD MAP")
  })

  it("distinguishes the Field Map from the Operations Map", () => {
    expect(navDetail({ path: "/field" })).toMatch(/field/i)
    expect(navDetail({ path: "/" })).toMatch(/operations map/i)
    expect(navDetail({ path: "/field" })).not.toEqual(navDetail({ path: "/" }))
  })
})

describe("phone STATUS tab", () => {
  it("opens the live Aegis radar alert feed rather than the disabled console handoff", () => {
    const aegis = PHONE_ROUTES.find((route) => route.label === "STATUS")
    expect(aegis?.path).toBe("/status")
    expect(ROUTES.some((route) => route.path === aegis?.path)).toBe(true)
  })
  it("gives every More destination a one-line detail", () => {
    for (const group of MORE_SECTIONS) for (const route of group.routes) expect(navDetail(route)).toBeTruthy()
  })
})
