import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import type { OpsConnectionState } from "../core/types"
import MobileHome from "./MobileHome"

const fixture = vi.hoisted(() => ({ state: "OFFLINE" as OpsConnectionState }))
vi.mock("../hooks/useViewport", () => ({ useViewport: () => "phone" }))
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ status: "authorized", session: { access_token: "test-access-token" } }) }))
vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => ({ state: {
  core: { state: fixture.state, detail: "Core test detail" },
  stormIntel: { state: "LIVE", detail: "Unrelated weather detail" },
} }) }))

describe("phone readiness", () => {
  it("uses a status monitor affordance for the system link instead of a menu icon", () => {
    const html = renderToString(<MemoryRouter><MobileHome /></MemoryRouter>)
    const headerLink = html.match(/<a[^>]*class="mobile-home__header-link"[^>]*>[^]*?<\/a>/)?.[0] ?? ""
    expect(headerLink).toContain('href="/system"')
    expect(headerLink).toContain('aria-label="Open system status"')
    expect(headerLink).toContain('<svg')
    expect(headerLink).toContain('aria-hidden="true"')
    expect(headerLink).toContain('<rect x="3" y="3" width="18" height="14" rx="2"')
    expect(headerLink).toContain('d="M6 10h3l2-4 2 8 2-4h3M12 17v4M8 21h8"')
    expect(headerLink).not.toContain('d="M4 6h16M4 12h16M4 18h16')
    expect(headerLink).not.toContain('aria-haspopup')
  })

  it.each<OpsConnectionState>(["OFFLINE", "UNAVAILABLE", "STALE", "DEGRADED", "CHECKING", "DEVELOPMENT"])("reports %s without a false ready/checking state", (state) => {
    fixture.state = state
    const html = renderToString(<MemoryRouter><MobileHome /></MemoryRouter>)
    expect(html).toContain(`Core ${state.toLowerCase()}`)
    expect(html).toContain(`data-state="${state}"`)
    expect(html).not.toContain("Core test detail")
    expect(html).not.toContain("OPS READY")
    expect(html).not.toContain("Unrelated weather detail")
    expect(html).toContain('href="/ai"')
    expect(html).toContain("Console handoff disabled")
    expect(html).not.toContain("test-access-token")
    expect(html).not.toContain("access_token=")
    expect(html).not.toContain("phaenon3.tail1d0673.ts.net")
  })
  it("labels a live Core narrowly, without claiming all services are ready", () => {
    fixture.state = "LIVE"
    const html = renderToString(<MemoryRouter><MobileHome /></MemoryRouter>)
    expect(html.replaceAll("<!-- -->", "")).toContain("Core online")
    expect(html).not.toContain("OPS READY")
  })
})
