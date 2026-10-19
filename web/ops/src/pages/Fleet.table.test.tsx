import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { expect, it, vi } from "vitest"
import Fleet from "./Fleet"
vi.mock("../core/useSharedOpsStatus", () => ({ useSharedOpsStatus: () => ({ fabric: { state: "LIVE", units: { units: [{ unit_id: "striker", display_name: "STRIKER", operator_name: "Spencer", role: "chaser", last_seen: Date.now() - 90_000, overall_health: "LIVE", devices: [{ device_id: "weather", display_label: "Weather station" }], weather: null }] } }, now: Date.now() }), statusAge: () => "Just now" }))
it("retains each chaser, role, device and last report in the Team table", () => {
  const html = renderToString(<MemoryRouter><Fleet /></MemoryRouter>)
  for (const text of ["<th>Chaser</th>", "<th>Role</th>", "<th>Device</th>", "<th>Last report</th>", "<th>Status</th>", "Spencer", "STRIKER", "chaser", "Weather station", "Last seen 1:30 ago", "Live"]) expect(html).toContain(text)
  expect(html).toContain('<h1>Team</h1>')
  expect(html).toContain('href="/producer/sources"')
  expect(html).not.toContain("TEAM · TEAM")
})
