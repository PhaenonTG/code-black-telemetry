import type { FabricNormalizedState } from "../../../../src/services/fabric";
import type { StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";

export type OpsConnectionState = "LIVE" | "DEGRADED" | "STALE" | "OFFLINE" | "UNAVAILABLE" | "CHECKING" | "DEVELOPMENT";

export interface CoreHealthSnapshot {
  state: OpsConnectionState;
  detail: string;
  checkedAt: number;
}

export interface FabricSnapshotState {
  state: OpsConnectionState;
  detail: string;
  checkedAt: number;
  health: unknown | null;
  units: FabricNormalizedState | null;
  wsState: "disabled" | "connecting" | "open" | "closed" | "error";
  lastWsEventAt: number | null;
  lastContactAt: number | null;
  error: string | null;
}

export interface StormIntelState {
  state: OpsConnectionState;
  detail: string;
  checkedAt: number;
  health: unknown | null;
  selectedPoint: { lat: number; lon: number } | null;
  pointLoading: boolean;
  requestId: number;
  pointSnapshot: StormIntelSnapshot | null;
  pointError: string | null;
}

export interface OpsCoreState {
  core: CoreHealthSnapshot;
  fabric: FabricSnapshotState;
  stormIntel: StormIntelState;
  refreshedAt: number;
}
