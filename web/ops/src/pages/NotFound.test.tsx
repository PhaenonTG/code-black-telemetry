import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"
import NotFound from "./NotFound"
import { BottomNav } from "../layouts/BottomNav"
import { activePhoneRoute } from "../layouts/phoneRoutes"
import { readFileSync } from "node:fs"

describe("RIP-12 unmatched routes", () => {
  it("renders a neutral kicker without highlighting Admin or More", () => {
    const html = renderToString(<MemoryRouter initialEntries={["/zz-bogus-route"]}><NotFound /></MemoryRouter>)
    expect(html).toContain("page-header__kicker")
    expect(html).toContain("Page not found")
    expect(html).not.toMatch(/ADMIN/)
    expect(activePhoneRoute("/zz-bogus-route")).toBe("")
  })

  it("does not mark any bottom-nav tab current on an unknown path", () => {
    const html = renderToString(<MemoryRouter initialEntries={["/zz-bogus-route"]}><BottomNav /></MemoryRouter>)
    expect(html).not.toContain('aria-current="page"')
    expect(html).not.toContain("bottom-nav__link active")
  })

  it("keeps More current for More children", () => {
    const html = renderToString(<MemoryRouter initialEntries={["/settings"]}><BottomNav /></MemoryRouter>)
    expect(html).toMatch(/href="\/more"/)
    expect(html).toMatch(/aria-current="page"/)
    expect(html).toContain("bottom-nav__link active")
  })
})

describe("RIP-7 not-found actions", () => {
  it("keeps a 44px min-height on Go back with enough specificity to beat the shell button reset", () => {
    const css = readFileSync(new URL("./NotFound.css", import.meta.url), "utf8")
    expect(css).toMatch(/\.shell[\s\S]*ops-not-found__actions[\s\S]*min-height:\s*44px/)
  })
})
