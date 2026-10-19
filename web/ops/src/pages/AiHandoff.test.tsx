import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import AiHandoff from "./AiHandoff"

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
    expect(html).not.toContain("access_token=")
    expect(html).not.toContain("fixture-only")
    expect(html).not.toContain("phaenon3.tail1d0673.ts.net")
    expect(html).not.toContain("<button")
  })
})
