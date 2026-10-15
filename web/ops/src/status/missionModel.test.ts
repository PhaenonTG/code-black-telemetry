import { describe, expect, it } from "vitest"
import { chaseReadiness, hostImpacts, projectHealthCounts } from "./missionModel"
import type { StatusCenterDocument, StatusProject } from "./statusCenterClient"

const project: StatusProject = { id: "ai", name: "Local AI", phase: "LIVE", summary: "", note: "", health: "UNKNOWN",
  monitored_count: 2, expected_count: 2, healthy_count: 1, troubled_count: 0, unknown_count: 1,
  services: [{ id: "core-ai", name: "Core AI", host: "core", state: "HEALTHY" },
    { id: "ai-router", name: "AI Router", host: "phaenon3", state: "UNKNOWN" }], missing_services: [], links: [] }

describe("mission grid evidence", () => {
  it("keeps monitored coverage separate from healthy service count", () => {
    expect(projectHealthCounts(project)).toEqual({ healthy: 1, unknown: 1, monitored: 2, expected: 2 })
  })

  it("shows a shared host's affected projects without claiming causation", () => {
    const doc: StatusCenterDocument = { projects: [project], hosts: [{ id: "phaenon3", name: "PHAENON3", state: "UNKNOWN" }] }
    expect(hostImpacts(doc).find((host) => host.id === "phaenon3")?.affected).toEqual(["Local AI"])
  })

  it("does not call an idle stream chase ready", () => {
    const doc: StatusCenterDocument = { radar: { state: "FRESH" }, storage: { state: "HEALTHY" },
      hosts: [{ id: "core", name: "Core", state: "HEALTHY" }, { id: "edge", name: "Edge", state: "HEALTHY" }],
      services: ["spencer-striker-weather", "spencer-striker-nav", "weather-alert-feed", "discord-bot", "edge-notification-dispatch"]
        .map((id) => ({ id, name: id, host: "core", state: "HEALTHY" })), streaming: { sources: [] } }
    const result = chaseReadiness(doc)
    expect(result.state).toBe("CHECK")
    expect(result.checks.find((check) => check.id === "stream")?.state).toBe("WATCH")
  })
})
