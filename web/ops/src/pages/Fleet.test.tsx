import { renderToString } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { CoreOpsContext, type CoreOpsContextValue } from "../core/CoreOpsContext"
import Fleet, { lastSeenLabel } from "./Fleet"

function renderFleet(hasSnapshot: boolean): string {
  const value: CoreOpsContextValue = {
    locationMode: "follow", updateDeviceLocation: () => {}, followDeviceLocation: () => {}, refreshPoint: () => {},
    config: { mode: "LIVE_CORE", coreBaseUrl: "http://localhost:8000", coreWsUrl: "ws://localhost:8000", unitId: "cbwx-unit-tessa", stormIntelPollSeconds: 30 },
    state: {
      core: { state: "LIVE", detail: "Core ready", checkedAt: 0 },
      fabric: {
        state: "LIVE", detail: "Fabric ready", checkedAt: 0, health: null,
        units: hasSnapshot ? {
          schema: "codeblack.fabric.unit-state", schema_version: "1.0.0", generated_at: 0, units: [],
          transports: {
            telemetry: { lane: "telemetry", current_contract: "", preferred_future_transport: "", implemented: false, deferred: [] },
            shared_application_state: { lane: "shared_application_state", current_contract: "", preferred_future_transport: "", implemented: false, deferred: [] },
            commands: { lane: "commands", current_contract: "", preferred_future_transport: "", implemented: false, deferred: [] },
          },
        } : null,
        streamState: "disabled", lastStreamEventAt: null, lastContactAt: null, error: null,
      },
      stormIntel: { state: "LIVE", detail: "", checkedAt: 0, health: null, selectedPoint: null, pointLoading: false, requestId: 0, pointSnapshot: null, pointError: null, pointHistory: [] },
      refreshedAt: 0,
    },
    selectedPoint: null, pointHistory: [], selectPoint: () => {}, selectHistoryPoint: () => {},
  }
  return renderToString(<MemoryRouter><CoreOpsContext.Provider value={value}><Fleet /></CoreOpsContext.Provider></MemoryRouter>)
}

describe("Fleet empty states", () => {
  it("distinguishes a valid empty snapshot from an unavailable snapshot", () => {
    expect(renderFleet(true)).toContain("NO UNITS REGISTERED")
    expect(renderFleet(false)).toContain("NO FABRIC UNIT SNAPSHOT")
  })
})

describe("Fleet last seen", () => {
  it("formats Core's ISO timestamp instead of showing NaN", () => {
    expect(lastSeenLabel(new Date(Date.now() - 90_000).toISOString())).toContain("Last seen 1:30 ago")
  })

  it("does not invent a timestamp for malformed data", () => {
    expect(lastSeenLabel("invalid")).toBe("Last seen unavailable")
  })
})
