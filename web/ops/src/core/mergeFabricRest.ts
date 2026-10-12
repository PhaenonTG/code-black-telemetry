import type { FabricSnapshotState } from "./types"
import { fabricStateFromSnapshot } from "./fabricSnapshot"

export function mergeFabricRest(current: FabricSnapshotState, rest: FabricSnapshotState, startedAt: number): FabricSnapshotState {
  const newerSocket = (current.lastWsEventAt ?? 0) > startedAt
  const units = rest.units ? fabricStateFromSnapshot(rest.units) : null
  return {
    ...rest,
    units: newerSocket ? current.units : units ?? current.units,
    wsState: current.wsState,
    lastWsEventAt: current.lastWsEventAt,
    lastContactAt: Math.max(current.lastContactAt ?? 0, rest.lastContactAt ?? 0) || null,
    error: rest.units && !units ? "Malformed Fabric snapshot" : rest.state === "LIVE" ? current.wsState === "error" ? current.error : null : rest.error,
    ...(rest.units && !units && !newerSocket ? { state: "DEGRADED" as const, detail: "Fabric returned an invalid snapshot; last received units retained" } : {}),
    ...(newerSocket ? { state: current.state, detail: current.detail } : {}),
  }
}
