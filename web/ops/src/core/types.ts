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
  pointHistory: StormIntelHistoryEntry[];
}

export interface OpsCoreState {
  core: CoreHealthSnapshot;
  fabric: FabricSnapshotState;
  stormIntel: StormIntelState;
  refreshedAt: number;
}

export interface StormIntelHistoryEntry {
  id: string;
  requested: { lat: number; lon: number };
  resolved: { lat: number; lon: number } | null;
  gridDistanceKm: number | null;
  provider: string;
  product: string | null;
  runTime: string | null;
  validTime: string | null;
  forecastHour: number | null;
  dataClass: string | null;
  selectedAt: number;
  summary: string;
}

// --- Soundings (/api/soundings/v1) -- mirrors weather.sounding_service.SoundingServiceResult's
// to_dict() shape 1:1 (Core's soundings_engine is a vendored copy of the same canonical
// pipeline Discord's /sounding and /hodo run -- see services/core-api's soundings_engine/
// PROVENANCE.md). Field-for-field, not reinterpreted, so this UI never computes meteorology
// itself -- it only renders what Core already derived. ---
export interface SoundingParameter {
  label: string;
  value: number | string | null;
  unit: string;
  provenance: "source" | "calculated";
  note: string | null;
}

export interface SoundingProfile {
  pressure_hpa: number[];
  height_m: number[];
  temp_c: number[];
  dewp_c: number[];
  u_ms: number[];
  v_ms: number[];
  parcel_temp_c: number[] | null;
}

export interface SoundingHodographPoint {
  height_m: number;
  u_ms: number;
  v_ms: number;
}

export interface SoundingPointResult {
  location: { name: string | null; latitude: number; longitude: number };
  model: string;
  run_time: string;
  forecast_hour: number;
  valid_time: string;
  generated_at: string;
  profile: SoundingProfile;
  derived: Record<string, SoundingParameter>;
  hodograph_points: SoundingHodographPoint[];
}

export type SoundingRequestState = "idle" | "loading" | "ready" | "stale" | "unavailable" | "degraded";

export interface SoundingLocationSearchResult {
  query_city: string;
  query_state: string;
  display_name: string;
  latitude: number;
  longitude: number;
  source: string;
}
