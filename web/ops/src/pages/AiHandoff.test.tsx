import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import AiHandoff from "./AiHandoff"
import { readFileSync } from "node:fs"

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => { throw new Error("The disabled handoff must not access a session") } }))

describe("disabled AEGIS console handoff", () => {
  it.each([
    "/ai",
    "/ai?return_to=https://phaenon3.tail1d0673.ts.net/ai",
    "/ai?return_to=https%3A%2F%2Funtrusted.invalid%2F%23access_token%3Dfixture-only",
  ])("keeps %s on a truthful credential-free OPS screen", (route) => {
    const html = renderToString(<MemoryRouter initialEntries={[route]}><AiHandoff /></MemoryRouter>)
    expect(html).toContain("AEGIS console handoff disabled")
    expect(html).toContain("Independent console sign-in has not been verified")
    expect(html).toContain('href="/"')
    expect(html).toContain('class="page-empty page-ai-handoff" role="status"')
    expect(html).toMatch(/<a[^>]*class="page-action-link"[^>]*>RETURN TO OPS<\/a>/)
    expect(html).not.toContain("access_token=")
    expect(html).not.toContain("fixture-only")
    expect(html).not.toContain("phaenon3.tail1d0673.ts.net")
    expect(html).not.toContain("<button")
  })

  it("scopes 12px text and a 44px tap target to this page at every viewport", () => {
    const css = readFileSync(new URL("./AiHandoff.css", import.meta.url), "utf8")
    expect(css).toMatch(/\.shell \.page-ai-handoff \.page-action-link\s*\{[^}]*font-size:\s*12px;[^}]*min-height:\s*44px/)
    expect(css).not.toContain("@media")
    expect(css).not.toMatch(/(?:^|\})\s*\.page-action-link\s*\{/)
    const source = readFileSync(new URL("./AiHandoff.tsx", import.meta.url), "utf8")
    expect(source).toContain('import "./AiHandoff.css"')
  })
})
