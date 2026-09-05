/**
 * Frontend mirror of the Code Black Core Storm Intel contract
 * (services/core-api/src/code_black_core_api/storm_intel/models.py).
 *
 * This file is the seam: presentation components only ever import from
 * here, never from `simulator.ts` or a future `restProvider.ts` directly.
 * Field names/shapes are kept 1:1 with the Python schema (camelCase
 * instead of snake_case) so a real Core provider is a drop-in, not a
 * rewrite of every consumer.
 */

export type ContextType = "AT_UNIT" | "AHEAD_OF_UNIT" | "SELECTED_TARGET";

export type ResolvedFrom = "unit_position" | "projected_position" | "explicit_target";

export const SUPPORTED_AHEAD_OF_UNIT_DISTANCES_MILES = [10, 20, 30] as const;
export type AheadOfUnitDistanceMiles = (typeof SUPPORTED_AHEAD_OF_UNIT_DISTANCES_MILES)[number];

export type MetricKey =
  | "sbcape"
  | "mlcape"
  | "mucape"
  | "sbcin"
  | "mlcin"
  | "mucin"
  | "surface_temperature"
  | "surface_dewpoint"
  | "relative_humidity"
  | "lcl_height"
  | "srh_0_1km"
  | "srh_0_3km"
  | "bulk_shear_0_6km"
  | "lapse_rate_0_3km"
  | "lapse_rate_700_500mb"
  | "significant_tornado_parameter"
  | "supercell_composite_parameter";

export type StormIntelFreshness = "current" | "aging" | "stale" | "unavailable" | "unknown";

/**
 * Explicit provenance class for a metric value. Core's real `MetricSource` (see
 * `services/core-api/.../storm_intel/models.py`) does not carry this as a field -- it is
 * *derived* client-side from `source.provider`/`runTime`/`validTime` by
 * `stormIntel/dataClass.ts`. Today Core only ships an HRRR provider (a pure NWP model), so real
 * metrics are always MODEL_ANALYSIS or MODEL_FORECAST, never OBSERVATION -- that reserved case
 * exists for a future observation-network provider (METAR/ASOS/mesonet), not a current one.
 * Never presented to the viewer as if a model value were an observation.
 */
export type DataClass = "OBSERVATION" | "MODEL_ANALYSIS" | "MODEL_FORECAST";

/** Mirrors Core Fabric's `PresenceState` (codeblack_core_api/fabric.py). */
export type PresenceState = "LIVE" | "DEGRADED" | "STALE" | "OFFLINE" | "NOT_CONFIGURED";

/** Overlay-facing subset of Fabric's `FabricUnitState` -- only what context resolution needs. */
export interface UnitIdentity {
  unitId: string;
  displayName: string;
  operatorName: string;
  overallHealth: PresenceState;
  lastSeen: string | null;
}

/** Which data source is actually feeding the overlay right now. Orthogonal to a snapshot's own
 * `simulation` flag -- Core itself may run its own simulation provider even when LIVE_CORE
 * transport is connected, per its `storm_intel_provider` setting. */
export type OverlayMode = "SIMULATION" | "FIXTURE" | "LIVE_CORE";

export interface MetricSource {
  provider: string;
  product: string;
  runTime: string | null;
  validTime: string | null;
  formulation: string | null;
}

export interface MetricTrend {
  direction: "rising" | "falling" | "steady" | "unknown";
  delta: number | null;
  periodMinutes: number | null;
}

export interface NormalizedMetric {
  key: MetricKey;
  label: string;
  value: number | null;
  unit: string | null;
  source: MetricSource | null;
  retrievedAt: string | null;
  ageSeconds: number | null;
  freshness: StormIntelFreshness;
  quality: "nominal" | "degraded" | "low_confidence" | "unknown" | null;
  availability: "available" | "unavailable";
  unavailableReason: string | null;
  trend: MetricTrend | null;
  derivation: string | null;
  /** Null only when `source` itself is null (e.g. an unavailable metric). */
  dataClass: DataClass | null;
}

export interface ContextLocation {
  available: boolean;
  latitude: number | null;
  longitude: number | null;
  resolvedFrom: ResolvedFrom | null;
  unitId: string | null;
  unitPositionObservedAt: string | null;
  unitPositionHealthState: string | null;
  headingDeg: number | null;
  distanceMiles: number | null;
  unavailableReason: string | null;
}

export interface StormIntelContext {
  contextType: ContextType;
  location: ContextLocation;
  requestedAt: string;
}

export interface StormIntelScore {
  available: boolean;
  value: number | null;
  label: string;
  algorithmId: string;
  algorithmVersion: string;
  inputsUsed: MetricKey[];
  unavailableReason: string | null;
}

export interface StormIntelSnapshot {
  schema: "codeblack.storm-intel.snapshot";
  schemaVersion: "1.0.0";
  generatedAt: string;
  context: StormIntelContext;
  providerName: string;
  simulation: boolean;
  metrics: NormalizedMetric[];
  score: StormIntelScore;
  canonicalUnits: Record<string, string>;
  available: boolean;
  unavailableReason: string | null;
}

/**
 * A single vertical-profile wind sample for the hodograph card. This has
 * no Core equivalent yet -- Core's Storm Intel contract only exposes
 * derived kinematic summaries (SRH/shear), not the raw wind profile a
 * hodograph is drawn from. Kept as its own overlay-local type so a future
 * Core "profile" endpoint can replace `simulator.ts`'s fixture without
 * touching `NormalizedMetric`.
 */
export interface WindProfileLevel {
  heightKm: number;
  band: "surface" | "low" | "mid" | "upper";
  speedKt: number;
  directionDeg: number;
}

export interface HodographData {
  levels: WindProfileLevel[];
  srh01: number | null;
  srh03: number | null;
  shear06: number | null;
  source: MetricSource | null;
  freshness: StormIntelFreshness;
  simulation: boolean;
}

/**
 * Public-facing presentation context that is NOT part of the Core Storm
 * Intel contract (city/state label, elevation, nearby-chaser count).
 * Deliberately kept separate from `StormIntelSnapshot` -- Core does not
 * own presentation-only or privacy-reduced fields.
 */
export interface PublicLocationInfo {
  city: string;
  state: string;
  elevationFt: number | null;
  nearbyChaserCount: number | null;
}

export type EventTakeoverKind =
  | "TOR_WARNING"
  | "SVR_WARNING"
  | "MESO_DISCUSSION"
  | "TOR_WATCH"
  | "PDS_TOR_WATCH"
  | "OBSERVED_TORNADO";

export interface EventTakeover {
  id: string;
  kind: EventTakeoverKind;
  headline: string;
  detail: string;
  issuedAt: string;
  holdMs: number;
}

export type SimulationScenario =
  | "low_end"
  | "severe_supercell"
  | "high_end_tornadic"
  | "strong_cap_high_instability"
  | "stale_data"
  | "partial_data"
  | "provider_failure"
  | "unavailable_unit_location";

export const SIMULATION_SCENARIOS: SimulationScenario[] = [
  "low_end",
  "severe_supercell",
  "high_end_tornadic",
  "strong_cap_high_instability",
  "stale_data",
  "partial_data",
  "provider_failure",
  "unavailable_unit_location",
];

export interface OverlayState {
  contextType: ContextType;
  scenario: SimulationScenario;
  snapshot: StormIntelSnapshot;
  hodograph: HodographData;
  publicLocation: PublicLocationInfo | null;
  takeover: EventTakeover | null;
}

/**
 * The seam a future real Core provider implements. `StormIntelSimulator`
 * (simulator.ts) is the only implementation in v1. A `RestStormIntelProvider`
 * (REST polling + `storm_intel.updated` WebSocket, matching Core's actual
 * routes) would implement the same shape without any change to
 * `store.ts` or components.
 */
export interface StormIntelProvider {
  subscribe(listener: () => void): () => void;
  getSnapshot(): OverlayState;
  setContextType(contextType: ContextType): void;
  setScenario(scenario: SimulationScenario): void;
  triggerTakeover(kind: EventTakeoverKind): void;
  dismissTakeover(): void;
  disconnect(): void;
}
