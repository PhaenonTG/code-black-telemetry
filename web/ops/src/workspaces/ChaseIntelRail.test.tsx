import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { expect, it, vi } from "vitest"
import { ChaseIntelRail, ChaseOfficialBanner } from "./ChaseIntelRail"
vi.mock("../core/client", () => ({ fetchForecast: vi.fn() }))
const intel = { point: { lat: 36, lon: -94 }, checkedAt: Date.parse("2026-11-02T16:30:00Z"), official: { status: "ready", alerts: [] }, officialError: false, nearby: { complete: true, states: ["AR"], threats: [] }, roads: null, aegis: { items: [] } } as unknown as NonNullable<Parameters<typeof ChaseOfficialBanner>[0]["intel"]>
it("moves nearby and point warning scopes into one Warnings card without losing safety copy", () => {
 const html = renderToString(<ChaseOfficialBanner intel={intel} point={intel.point} vehiclePosition={false} />)
 for (const text of ["Warnings", "Nearby coverage", "No active warning returned for this point", "No polygon warnings returned for", "AR", "not an all-clear", "Official warnings first · Aegis findings are internal", "10:30 AM CST"]) expect(html.toLowerCase()).toContain(text.toLowerCase())
 expect(html).not.toContain("36.000")
})
it("retains roads, route context and Aegis when warnings move out of the rail", () => {
 const route = { status: "idle", roads: null, path: [] } as unknown as Parameters<typeof ChaseIntelRail>[0]["route"]
 const html = renderToString(<MemoryRouter><ChaseIntelRail intel={intel} point={intel.point} vehiclePosition={false} route={route} routeOrigin={null} routeDestination={null} /></MemoryRouter>)
 for (const text of ["Road conditions", "Route context", "Aegis internal", "Set a route destination", "No recent nearby candidate returned"]) expect(html).toContain(text)
 expect(html).not.toContain("Nearby warnings")
 expect(html).not.toContain("Field target")
})
