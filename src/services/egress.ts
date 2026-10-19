import type { ObservationProvenance } from "./mapLayerModels";

export type EgressDataState = "GOOD" | "DEGRADED" | "STALE" | "UNAVAILABLE";
export type EgressInputKind =
  | "gps"
  | "road-graph"
  | "radar-threat"
  | "storm-motion"
  | "warning-polygons"
  | "road-conditions"
  | "flooding"
  | "traffic"
  | "manual-hazards";

export interface EgressInputState {
  kind: EgressInputKind;
  state: EgressDataState;
  message: string;
  updatedAt: number | null;
  provenance: ObservationProvenance | null;
}

export interface EgressContext {
  createdAt: number;
  chaseSessionId: string | null;
  currentPosition: {
    lat: number;
    lon: number;
    headingDeg: number | null;
    speedMph: number | null;
  } | null;
  inputs: EgressInputState[];
}

export interface CandidateEgressRoute {
  id: string;
  label: string;
  distanceMiles: number | null;
  travelTimeMinutes: number | null;
  directionHint: string | null;
  inputStates: EgressInputState[];
}

export interface EgressRouteScore {
  routeId: string;
  usable: boolean;
  confidence: EgressDataState;
  score: number | null;
  warnings: string[];
}

export function createEgressContext(args: {
  chaseSessionId: string | null;
  currentPosition: EgressContext["currentPosition"];
  inputs?: EgressInputState[];
  now?: number;
}): EgressContext {
  const gpsState: EgressInputState = {
    kind: "gps",
    state: args.currentPosition ? "GOOD" : "UNAVAILABLE",
    message: args.currentPosition ? "Current GPS available." : "Current GPS unavailable.",
    updatedAt: args.currentPosition ? (args.now ?? Date.now()) : null,
    provenance: null,
  };
  return {
    createdAt: args.now ?? Date.now(),
    chaseSessionId: args.chaseSessionId,
    currentPosition: args.currentPosition,
    inputs: [gpsState, ...(args.inputs ?? [])],
  };
}

export function summarizeEgressReadiness(context: EgressContext) {
  const unavailable = context.inputs.filter((input) => input.state === "UNAVAILABLE");
  const stale = context.inputs.filter((input) => input.state === "STALE");
  const degraded = context.inputs.filter((input) => input.state === "DEGRADED");
  if (!context.currentPosition) {
    return { state: "UNAVAILABLE" as const, message: "GPS unavailable. Escape routing cannot start." };
  }
  if (unavailable.length > 0 || stale.length > 0) {
    return { state: "DEGRADED" as const, message: "Escape context is incomplete. Do not treat routing as guaranteed safe." };
  }
  if (degraded.length > 0) {
    return { state: "DEGRADED" as const, message: "Escape context has degraded inputs." };
  }
  return { state: "GOOD" as const, message: "Core escape context ready." };
}

export function scoreCandidateRoute(route: CandidateEgressRoute): EgressRouteScore {
  const badInputs = route.inputStates.filter((input) => input.state === "UNAVAILABLE" || input.state === "STALE");
  if (badInputs.length > 0) {
    return {
      routeId: route.id,
      usable: false,
      confidence: "DEGRADED",
      score: null,
      warnings: badInputs.map((input) => `${input.kind.toUpperCase()} ${input.state}`),
    };
  }
  return {
    routeId: route.id,
    usable: true,
    confidence: route.inputStates.some((input) => input.state === "DEGRADED") ? "DEGRADED" : "GOOD",
    score: route.travelTimeMinutes == null ? null : Math.max(0, 100 - route.travelTimeMinutes),
    warnings: [],
  };
}
