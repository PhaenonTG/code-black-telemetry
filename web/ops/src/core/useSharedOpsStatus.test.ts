import { afterEach, describe, expect, it, vi } from "vitest"
import { createPointLookup, statusAge, statusView } from "./useSharedOpsStatus"
import type { OpsCoreConfig } from "./config"
import type { OpsCoreState } from "./types"
vi.mock("../lib/supabase", () => ({ supabase: null }))
const config: OpsCoreConfig = { mode: "LIVE_CORE", coreBaseUrl: "/api/core", coreWsUrl: "", unitId: "", stormIntelPollSeconds: 30 }
const good: Pick<OpsCoreState, "core" | "fabric"> = {
  core: { state: "LIVE", detail: "Core ready", checkedAt: 1000 },
  fabric: { state: "LIVE", detail: "Fabric ready", checkedAt: 1000, health: null,
    units: { units: [{ unit_id: "spencer" }, { unit_id: "nick" }] } as NonNullable<OpsCoreState["fabric"]["units"]>,
    unitsReceivedAt: 1000, streamState: "open", lastStreamEventAt: 1000, lastContactAt: 1000, error: null },
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe("shared Core/Fabric status", () => {
  it("retains the identical units and core observation through navigation/checking", () => {
    const checking = { core: { ...good.core, state: "CHECKING" as const }, fabric: { ...good.fabric, units: null, streamState: "connecting" as const } }
    const producer = statusView(checking, good, 5000)
    const chase = statusView(checking, good, 5000)
    expect(producer).toEqual(chase)
    expect(chase.fabric.units).toBe(good.fabric.units)
    expect(chase.core.state).toBe("STALE")
    expect(chase.fabric.state).toBe("STALE")
    expect(statusAge(chase.fabric.unitsReceivedAt, 5000)).toBe("4s ago")
  })
  it("marks old open feeds stale and recovers when a new snapshot arrives", () => {
    expect(statusView(good, null, 62_000).fabric.state).toBe("STALE")
    expect(statusView(good, null, 2000).fabric.state).toBe("LIVE")
    const failed = { core: { ...good.core, state: "UNAVAILABLE" as const, checkedAt: 9000 }, fabric: { ...good.fabric, units: null } }
    expect(statusView(failed, good, 9000).core.checkedAt).toBe(1000)
    expect(statusView(good, failed, 2000).core.state).toBe("LIVE")
  })
})
describe("point lookup deduplication", () => {
  it("shares an in-flight navigation read and completed cache; location and explicit refresh invalidate it", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ schema: "codeblack.storm-intel.snapshot", provider_name: "test", generated_at: "2026-10-18T00:00:00Z", metrics: [], context: { context_type: "SELECTED_TARGET", requested_at: "2026-10-18T00:00:00Z", location: {} }, score: { label: "unavailable", algorithm_id: "test", algorithm_version: "1" }, available: false })))
    vi.stubGlobal("fetch", fetch)
    const lookup = createPointLookup()
    const point = { lat: 36, lon: -94 }
    const first = lookup(config, point)
    expect(lookup(config, { ...point })).toBe(first)
    await first
    expect(lookup(config, point)).toBe(first)
    expect(fetch).toHaveBeenCalledTimes(1)
    await lookup(config, { ...point, lat: 37 })
    await lookup(config, point, 1)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls[0][0]).toContain("/api/storm-intel/v1/point?")
  })
  it("does not cache failures and expires completed results", async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockImplementation(async () => new Response(JSON.stringify({ schema: "codeblack.storm-intel.snapshot", provider_name: "test", generated_at: "2026-10-18T00:00:00Z", metrics: [], context: { context_type: "SELECTED_TARGET", requested_at: "2026-10-18T00:00:00Z", location: {} }, score: { label: "unavailable", algorithm_id: "test", algorithm_version: "1" }, available: false })))
    vi.stubGlobal("fetch", fetch)
    const lookup = createPointLookup(), point = { lat: 36, lon: -94 }
    await expect(lookup(config, point)).rejects.toThrow("unavailable")
    await lookup(config, point)
    vi.advanceTimersByTime(30_001)
    await lookup(config, point)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
