import { readFileSync } from "node:fs"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ROUTES, ROUTE_ALIASES, NOT_FOUND_ROUTE, routeEyebrow, routeMatchesQuery } from "./routes"
import { NAV_DETAILS, activePhoneRoute, PHONE_ROUTES } from "../layouts/phoneRoutes"
import { PageHeader } from "../components/PageHeader"

describe("locked navigation", () => {
  it("has no alias chains or cycles", () => {
    const aliases: Record<string, string> = ROUTE_ALIASES
    for (const [source, target] of Object.entries(aliases)) {
      expect(aliases[target]).toBeUndefined()
      const visited = new Set([source])
      let next: string | undefined = target
      while (next) { expect(visited.has(next)).toBe(false); visited.add(next); next = aliases[next] }
    }
  })
  it("keeps every detail key reachable through sidebar or its tab/alias", () => {
    const paths = new Set([...ROUTES.filter(route => route.inSidebar).map(route => route.path), ...Object.keys(ROUTE_ALIASES), "/setup-review", "/producer/sources", "/status/telemetry"])
    for (const key of Object.keys(NAV_DETAILS)) expect(paths.has(key), key).toBe(true)
  })
  it.each(["/status", "/status/health", "/status/telemetry", "/coordination"])("lights Status on %s", path => expect(activePhoneRoute(path)).toBe("/status"))
  it.each(["/team", "/vehicle-weather", "/aegis-alerts", "/field"])("lights More on %s", path => expect(activePhoneRoute(path)).toBe("/more"))
  it("keeps labels short and icons distinct", () => {
    expect(PHONE_ROUTES.every(route => route.label.length <= 6)).toBe(true)
    const icons = ROUTES.filter(route => route.inSidebar).map(route => route.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })
  it("uses a single eyebrow for Team and Status", () => {
    for (const path of ["/team", "/status"]) {
      const route = ROUTES.find(route => route.path === path)!
      expect(routeEyebrow(route)).toBe(route.section)
      const html = renderToString(<PageHeader routePath={path} title="Fallback" />)
      expect(html).toContain(`<h1>${route.label}</h1>`)
      expect(html).not.toContain(`${route.section} · ${route.label}`)
    }
  })
  it("uses a neutral unmatched-route eyebrow without an Admin section", () => {
    expect(routeEyebrow(NOT_FOUND_ROUTE)).toBe("Page not found")
    expect(routeEyebrow(NOT_FOUND_ROUTE)).not.toMatch(/ADMIN/i)
    const html = renderToString(<PageHeader routePath="*" title="" />)
    expect(html).toContain("Page not found")
    expect(html).not.toMatch(/ADMIN/)
  })
  it("keeps /field on the Field map even at a phone viewport", () => {
    // App does not branch /field by viewport; only / renders MobileHome.
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    expect(source).toContain('<Route path="/field" element={<OpsWorkstation focus="FIELD INTELLIGENCE" />} />')
    expect(ROUTE_ALIASES).not.toHaveProperty("/field")
    expect(activePhoneRoute("/field")).toBe("/more")
  })
})

it.each([["System health", "/status"], ["Program Status", "/producer"], ["workspace chase", "/chase-desk"], ["fleet", "/team"]])("finds old bookmark %s in page search", (query, destination) => {
  expect(ROUTES.filter(route => route.inSidebar && routeMatchesQuery(route, query)).map(route => route.path)).toContain(destination)
})
