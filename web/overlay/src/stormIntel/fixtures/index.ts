/**
 * Recorded fixture sequences for QA without a live Core connection. Each frame is a fully
 * normalized `OverlayState` -- exactly what a real adapter would hand the store, per
 * `docs/design/overlay-live-data-integration.md`. No live Core has been available to capture
 * real traffic from yet, so these are hand-authored using the same builders `StormIntelSimulator`
 * uses, then frozen as static data and marked `simulation: false` (this is what a *recorded real*
 * payload would look like, distinct from `StormIntelSimulator`'s own on-the-fly `simulation: true`
 * generation). No secrets or network credentials are recorded here -- there is nothing to record.
 */
import { buildHodograph, buildMetrics, publicLocationFor, scoreFromMetrics } from "../scenarios";
import type { EventTakeover, HodographData, OverlayState, StormIntelSnapshot } from "../types";
import type { FixtureSequence } from "../fixtureProvider";

const NOW = new Date("2026-06-04T21:00:00.000Z");

function frameFrom(
  scenarioLike: Parameters<typeof buildMetrics>[0],
  overrides: Partial<StormIntelSnapshot> = {},
): { snapshot: StormIntelSnapshot; hodograph: HodographData } {
  const { metrics, source, freshness } = buildMetrics(scenarioLike, NOW);
  const score = scoreFromMetrics(metrics);
  const hodograph = buildHodograph(scenarioLike, metrics, source, freshness);
  const snapshot: StormIntelSnapshot = {
    schema: "codeblack.storm-intel.snapshot",
    schemaVersion: "1.0.0",
    generatedAt: NOW.toISOString(),
    context: {
      contextType: "AT_UNIT",
      location: {
        available: true,
        latitude: 35.22,
        longitude: -97.44,
        resolvedFrom: "unit_position",
        unitId: null, // fixtures never carry an internal unit id into overlay-facing data
        unitPositionObservedAt: NOW.toISOString(),
        unitPositionHealthState: "LIVE",
        headingDeg: null,
        distanceMiles: null,
        unavailableReason: null,
      },
      requestedAt: NOW.toISOString(),
    },
    providerName: "fixture",
    simulation: false,
    metrics,
    score,
    canonicalUnits: {},
    available: true,
    unavailableReason: null,
    ...overrides,
  };
  return { snapshot, hodograph };
}

function overlayState(
  built: { snapshot: StormIntelSnapshot; hodograph: HodographData },
  takeover: EventTakeover | null = null,
): OverlayState {
  return {
    contextType: "AT_UNIT",
    scenario: "low_end",
    snapshot: built.snapshot,
    hodograph: built.hodograph,
    publicLocation: publicLocationFor("severe_supercell"),
    takeover,
  };
}

const UNAVAILABLE_LOCATION = {
  available: false,
  latitude: null,
  longitude: null,
  resolvedFrom: null,
  unitId: null,
  unitPositionObservedAt: null,
  unitPositionHealthState: null,
  headingDeg: null,
  distanceMiles: null,
  unavailableReason: "Live Core connection lost. Reconnecting...",
} as const;

function unavailableState(reason: string): OverlayState {
  return {
    contextType: "AT_UNIT",
    scenario: "low_end",
    snapshot: {
      schema: "codeblack.storm-intel.snapshot",
      schemaVersion: "1.0.0",
      generatedAt: NOW.toISOString(),
      context: { contextType: "AT_UNIT", location: { ...UNAVAILABLE_LOCATION, unavailableReason: reason }, requestedAt: NOW.toISOString() },
      providerName: "fixture",
      simulation: false,
      metrics: [],
      score: {
        available: false,
        value: null,
        label: "Code Black Storm Environment Score (experimental, Code Black-derived)",
        algorithmId: "codeblack-storm-intel-score-prototype",
        algorithmVersion: "0.1.0-experimental",
        inputsUsed: [],
        unavailableReason: reason,
      },
      canonicalUnits: {},
      available: false,
      unavailableReason: reason,
    },
    hodograph: { levels: [], srh01: null, srh03: null, shear06: null, source: null, freshness: "unavailable", simulation: false },
    publicLocation: null,
    takeover: null,
  };
}

const NORMAL: FixtureSequence = {
  name: "normal",
  description: "Ordinary low-end environment, fully available, no takeover.",
  loop: false,
  frames: [{ holdMs: 3_600_000, state: overlayState(frameFrom("low_end")) }],
};

const TORNADIC: FixtureSequence = {
  name: "tornadic",
  description: "High-end tornadic environment, fully available, no takeover.",
  loop: false,
  frames: [{ holdMs: 3_600_000, state: overlayState(frameFrom("high_end_tornadic")) }],
};

const STALE_TRANSITION: FixtureSequence = {
  name: "stale_transition",
  description: "Data starts current, then transitions to stale without a live clock.",
  loop: false,
  frames: [
    { holdMs: 8000, state: overlayState(frameFrom("severe_supercell")) },
    { holdMs: 3_600_000, state: overlayState(frameFrom("stale_data")) },
  ],
};

const PROVIDER_FAILURE: FixtureSequence = {
  name: "provider_failure",
  description: "Upstream provider failure -- explicit unavailable state, never frozen old data.",
  loop: false,
  frames: [{ holdMs: 3_600_000, state: overlayState(frameFrom("provider_failure")) }],
};

const WARNING_TAKEOVER: FixtureSequence = {
  name: "warning_takeover",
  description: "Otherwise-normal data with an operator-triggered Tornado Warning takeover active.",
  loop: false,
  frames: [
    {
      holdMs: 3_600_000,
      state: overlayState(frameFrom("severe_supercell"), {
        id: "TOR_WARNING-fixture",
        kind: "TOR_WARNING",
        headline: "TORNADO WARNING",
        detail: "Radar-indicated rotation. Take shelter now.",
        issuedAt: NOW.toISOString(),
        holdMs: 9000,
      }),
    },
  ],
};

const RECONNECT_SEQUENCE: FixtureSequence = {
  name: "reconnect_sequence",
  description: "Connection drops to an explicit unavailable state, then recovers. Loops for QA.",
  loop: true,
  frames: [
    { holdMs: 5000, state: overlayState(frameFrom("severe_supercell")) },
    { holdMs: 4000, state: unavailableState("Live Core connection lost. Reconnecting...") },
    { holdMs: 5000, state: overlayState(frameFrom("severe_supercell")) },
  ],
};

export const FIXTURES: Record<string, FixtureSequence> = {
  normal: NORMAL,
  tornadic: TORNADIC,
  stale_transition: STALE_TRANSITION,
  provider_failure: PROVIDER_FAILURE,
  warning_takeover: WARNING_TAKEOVER,
  reconnect_sequence: RECONNECT_SEQUENCE,
};
