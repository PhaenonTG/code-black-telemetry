import { readFileSync } from "node:fs"
import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import Stream from "./Stream"

vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => ({ config: {} }) }))
vi.mock("../status/statusCenterClient", () => ({ fetchStatusCenter: vi.fn() }))

describe("internal navigation indicators", () => {
  it("keeps the Stream team tab in the current application", () => {
    const html = renderToString(<MemoryRouter><Stream /></MemoryRouter>)
    expect(html).toContain('aria-label="Team and devices" href="/chase"')
    expect(html).not.toContain('target="_blank"')
    expect(html).not.toContain("\u2197")
  })

  it.each(["ProducerWorkspace", "TornadoPotential"])("does not mark internal router links as external in %s", (page) => {
    const source = readFileSync(new URL(`./${page}.tsx`, import.meta.url), "utf8")
    const links = source.match(/<Link\b[^>]*>[\s\S]*?<\/Link>/g) ?? []
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).not.toContain("\u2197")
  })
})
