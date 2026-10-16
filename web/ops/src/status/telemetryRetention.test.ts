import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { MissionGrid } from "./MissionGrid"
import type { StatusCenterDocument } from "./statusCenterClient"
const report: StatusCenterDocument = { projects: [{
  id: "preserved-project", name: "Preserved project", phase: "LIVE", summary: "Snapshot", note: "Evidence", health: "HEALTHY",
  monitored_count: 1, expected_count: 1, healthy_count: 1, troubled_count: 0, unknown_count: 0,
  services: [{ id: "one", name: "Detailed service evidence", host: "core", state: "HEALTHY" }], missing_services: [], links: [],
}] }
it("preserves the last project report through a failed refresh and marks it non-current", () => {
  const markup = renderToStaticMarkup(createElement(MissionGrid, { document: report, error: "Timeout" }))
  expect(markup).toContain("Preserved project")
  expect(markup).toContain("These are not current health checks")
  expect(markup).not.toContain("Detailed service evidence")
})
it("never invents a last report when the initial request fails", () => {
  const markup = renderToStaticMarkup(createElement(MissionGrid, { document: null, error: "Timeout" }))
  expect(markup).toContain("Project health is unavailable")
  expect(markup).not.toContain("Preserved project")
})
