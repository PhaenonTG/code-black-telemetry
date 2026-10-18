import type { FabricSnapshotState } from "./types"

// Preserve the current public feed's existing ten-second stream preference, and
// carry the receipt clock from the same snapshot selected for rendering.
export function selectFabricReceipt(current: FabricSnapshotState, rest: FabricSnapshotState, now = Date.now()) {
  const streamHealthy = current.streamState === "open" && current.lastStreamEventAt !== null && now - current.lastStreamEventAt < 10_000
  return streamHealthy
    ? { units: current.units, unitsReceivedAt: current.unitsReceivedAt ?? null }
    : { units: rest.units, unitsReceivedAt: rest.units ? rest.unitsReceivedAt ?? null : null }
}
