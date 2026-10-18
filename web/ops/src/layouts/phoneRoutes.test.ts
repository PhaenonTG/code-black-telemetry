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
    expect(activePhoneRoute("/radar-other")).toBe("/more")
  })
})

describe("More / sidebar navigation parity", () => {
  const morePaths = MORE_SECTIONS.flatMap((group) => group.routes.map((route) => route.path))

  it("lists the workspaces on phone More (Chase Desk, Setup Review, Producer)", () => {
    const workspaces = MORE_SECTIONS.find((group) => group.section === "WORKSPACES")
    expect(workspaces?.routes.map((route) => route.path).sort()).toEqual(["/analysis", "/producer", "/workspace/chase"])
    expect(workspaces?.routes.map((route) => route.label)).toContain("SETUP REVIEW")
  })

  it("only links existing routes, without duplicates", () => {
    const known = new Set(ROUTES.map((route) => route.path))
    expect(morePaths.every((path) => known.has(path))).toBe(true)
    expect(new Set(morePaths).size).toBe(morePaths.length)
  })

  it("mirrors every live sidebar destination that is not already in the bottom bar", () => {
    const bottom = new Set(PHONE_ROUTES.map((route) => route.path))
    const expected = ROUTES.filter((route) => route.inSidebar && (route.state === "LIVE" || route.path === "/radar-r3") && !bottom.has(route.path)).map((route) => route.path)
    expect(morePaths.sort()).toEqual(expected.sort())
  })

  it("never repeats bottom-bar destinations or development placeholders", () => {
    for (const path of ["/", "/radar", "/ai", "/more"]) expect(morePaths).not.toContain(path)
    for (const path of ["/models", "/consensus", "/targets"]) expect(morePaths).not.toContain(path)
    expect(ROUTES.filter((route) => route.state === "DEVELOPMENT" && route.path !== "/radar-r3").some(isMoreDestination)).toBe(false)
  })

  it("does not duplicate System health in More because the OPS tab opens it", () => {
    // /system is in the bottom bar as OPS, so it is not duplicated in More.
    expect(morePaths).not.toContain("/system")
    expect(PHONE_ROUTES.find((route) => route.path === "/system")?.title).toBe("System health")
  })

  it("uses section headings that do not repeat an item label", () => {
    const itemLabels = new Set(ROUTES.map((route) => navLabel(route).toUpperCase()))
    for (const section of NAV_SECTIONS) expect(itemLabels.has(NAV_SECTION_LABELS[section].toUpperCase())).toBe(false)
    expect(navLabel({ path: "/system", label: "SYSTEM" })).toBe("SYSTEM HEALTH")
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
