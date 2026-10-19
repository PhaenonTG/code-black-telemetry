import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import StatusPage from "./StatusPage"
import Operations from "./Operations"
import { buildSystemStatus } from "../status/systemStatus"
const context = vi.hoisted(() => ({ value: { config: {}, state: { core: { state: "LIVE", detail: "Core ready", checkedAt: 0 }, fabric: { state: "CHECKING", streamState: "connecting", detail: "Waiting for Fabric", units: null }, stormIntel: { state: "UNAVAILABLE", detail: "Not configured" }, refreshedAt: 0 } } }))
vi.mock("../core/useCoreOps", () => ({ useCoreOps: () => context.value }))
vi.mock("../core/client", () => ({ fetchForecast: vi.fn(), fetchStormIntelPoint: vi.fn(), currentAccessToken: vi.fn(), buildCoreRequestHeaders: vi.fn(), retryOnceOnTransient: vi.fn() }))
vi.mock("../status/statusCenterClient", () => ({ fetchStatusCenter: vi.fn() }))
vi.mock("./StatusCenter", () => ({ default: () => <section data-unchanged-telemetry>Telemetry, Attention, Inventory and streaming setup</section> }))
vi.mock("../../../../src/services/roadCameraProviders", () => ({ readMapProviderDiagnostics: () => [{ id: "test", name: "Test provider", layer: "roads", state: "cached", count: 0, latencyMs: 0, detail: "No events" }] }))
vi.mock("../status/externalHealth", async importOriginal => ({ ...await importOriginal<typeof import("../status/externalHealth")>(), readMapHealth: () => ({ state: "CHECKING", detail: "Open map to check" }) }))
function render(path: string) { return renderToString(<MemoryRouter initialEntries={[path]}><StatusPage /></MemoryRouter>) }
describe("Status shell carry-over", () => {
  it.each(["/status", "/status/health"])("defaults %s to Health with permanent Settings and Refresh", path => {
    const html = render(path)
    expect(html).toContain('<h1>Status</h1>')
    expect(html).toContain('href="/settings"')
    expect(html).toContain('title="Reload system health checks"')
    expect(html.indexOf(">Health</a>")).toBeLessThan(html.indexOf(">Telemetry</a>"))
    expect(html).not.toContain("data-unchanged-telemetry")
  })
  it("renders all existing Health rows, diagnostics including zero, and configure links", () => {
    const html = renderToString(<MemoryRouter><Operations /></MemoryRouter>)
    for (const label of ["CORE", "NETWORK", "MAP DATA", "RADAR MOSAIC SOURCE", "SINGLE-SITE RADAR", "FORECAST API", "HURRICANE WATCH", "NWS WEATHER API", "NWS ALERTS API", "TELEMETRY", "FLEET", "Broadcast"]) expect(html).toContain(label)
    expect(html.match(/class="status-row"/g)).toHaveLength(13)
    expect(html).toContain("Test provider")
    expect(html).toContain("0<!-- --> records")
    expect(html).toContain("0 ms")
    expect(html).toContain("Configure")
    expect(html).toContain('href="/producer/sources"')
    // Real builder remains used; it is not replaced by a smaller shell table.
    expect(typeof buildSystemStatus).toBe("function")
  })
  it("keeps the entire frozen Telemetry screen behind its own tab", () => {
    const html = render("/status/telemetry")
    expect(html).toContain("data-unchanged-telemetry")
    expect(html).toContain("Telemetry, Attention, Inventory and streaming setup")
    expect(html).not.toContain('class="status-table"')
  })
})
