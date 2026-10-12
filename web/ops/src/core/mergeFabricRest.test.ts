import { describe, expect, it } from "vitest"
import { mergeFabricRest } from "./mergeFabricRest"
import type { FabricSnapshotState } from "./types"

const boundary = (lane: "telemetry" | "shared_application_state" | "commands") => ({ lane, current_contract: "QA", preferred_future_transport: "QA", implemented: true, deferred: [] })
const normalized: NonNullable<FabricSnapshotState["units"]> = { schema: "codeblack.fabric.unit-state", schema_version: "1.0.0", generated_at: 100, units: [], transports: { telemetry: boundary("telemetry"), shared_application_state: boundary("shared_application_state"), commands: boundary("commands") } }
const state = (patch: Partial<FabricSnapshotState> = {}): FabricSnapshotState => ({ state: "LIVE", detail: "REST", checkedAt: 100, health: {}, units: normalized, wsState: "disabled", lastWsEventAt: null, lastContactAt: 100, error: null, ...patch })
describe("Fabric REST / socket reconciliation", () => {
  it("advances REST-only contact time and clears a recovered REST error", () => {
    const merged = mergeFabricRest(state({ state: "UNAVAILABLE", error: "old outage" }), state({ lastContactAt: 300 }), 200)
    expect(merged.lastContactAt).toBe(300)
    expect(merged.error).toBeNull()
    expect(merged.state).toBe("LIVE")
  })
  it("retains an update that arrived over the socket while REST was in flight", () => {
    const units = { ...normalized, generated_at: 300 }
    const merged = mergeFabricRest(state({ units, wsState: "open", lastWsEventAt: 300, lastContactAt: 300, detail: "Socket snapshot" }), state({ lastContactAt: 250 }), 200)
    expect(merged.units).toBe(units)
    expect(merged.lastContactAt).toBe(300)
    expect(merged.detail).toBe("Socket snapshot")
  })
  it("keeps last received units on failure without hiding the failure", () => {
    const current = state()
    const merged = mergeFabricRest(current, state({ state: "UNAVAILABLE", units: null, lastContactAt: null, error: "REST failed" }), 200)
    expect(merged.units).toBe(current.units)
    expect(merged.lastContactAt).toBe(100)
    expect(merged.state).toBe("UNAVAILABLE")
    expect(merged.error).toBe("REST failed")
  })
  it("normalizes ISO wire clocks for REST and flags malformed responses", () => {
    const units = { ...normalized, generated_at: "2026-10-12T08:34:57Z" } as unknown as typeof normalized
    expect(mergeFabricRest(state(), state({ units }), 200).units?.generated_at).toBe(Date.parse("2026-10-12T08:34:57Z"))
    const invalid = mergeFabricRest(state(), state({ units: { ...units, generated_at: NaN } }), 200)
    expect(invalid.state).toBe("DEGRADED")
    expect(invalid.error).toBe("Malformed Fabric snapshot")
    expect(invalid.units).toBe(normalized)
  })
})
