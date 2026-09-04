import {
  buildHodograph,
  buildMetrics,
  publicLocationFor,
  scoreFromMetrics,
} from "./scenarios";
import type {
  ContextType,
  EventTakeover,
  EventTakeoverKind,
  OverlayState,
  SimulationScenario,
  StormIntelProvider,
  StormIntelSnapshot,
} from "./types";

const TAKEOVER_HEADLINES: Record<EventTakeoverKind, { headline: string; detail: string; holdMs: number }> = {
  TOR_WARNING: {
    headline: "TORNADO WARNING",
    detail: "Radar-indicated rotation. Take shelter now.",
    holdMs: 9000,
  },
  SVR_WARNING: {
    headline: "SEVERE THUNDERSTORM WARNING",
    detail: "Damaging wind and large hail possible.",
    holdMs: 7000,
  },
  MESO_DISCUSSION: {
    headline: "MESOSCALE DISCUSSION",
    detail: "SPC monitoring developing severe potential.",
    holdMs: 6000,
  },
  TOR_WATCH: {
    headline: "TORNADO WATCH",
    detail: "Conditions favorable for tornadoes.",
    holdMs: 6000,
  },
  PDS_TOR_WATCH: {
    headline: "PDS TORNADO WATCH",
    detail: "Particularly Dangerous Situation. Stay alert.",
    holdMs: 8000,
  },
  OBSERVED_TORNADO: {
    headline: "TORNADO OBSERVED",
    detail: "Confirmed tornado on the ground.",
    holdMs: 10000,
  },
};

/**
 * Deterministic, explicit simulation provider. Mirrors the shape a real
 * `RestStormIntelProvider` (polling `/api/storm-intel/v1/...` + subscribing
 * to `storm_intel.updated`) would implement -- see `types.ts`.
 *
 * Every snapshot this produces carries `simulation: true`. Production must
 * never be able to mistake this for a live feed.
 */
export class StormIntelSimulator implements StormIntelProvider {
  private listeners = new Set<() => void>();
  private contextType: ContextType;
  private scenario: SimulationScenario;
  private takeover: EventTakeover | null = null;
  private takeoverTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval>;
  private snapshot: OverlayState;

  constructor(initialContext: ContextType = "AT_UNIT", initialScenario: SimulationScenario = "low_end") {
    this.contextType = initialContext;
    this.scenario = initialScenario;
    this.snapshot = this.compute();
    this.tickTimer = setInterval(() => {
      this.snapshot = this.compute();
      this.emit();
    }, 5000);
  }

  private compute(): OverlayState {
    const now = new Date();
    const { metrics, source, freshness } = buildMetrics(this.scenario, now);
    const score = scoreFromMetrics(metrics);
    const hodograph = buildHodograph(this.scenario, metrics, source, freshness);
    const publicLocation = publicLocationFor(this.scenario);
    const unavailable = this.scenario === "provider_failure" || this.scenario === "unavailable_unit_location";

    const snapshot: StormIntelSnapshot = {
      schema: "codeblack.storm-intel.snapshot",
      schemaVersion: "1.0.0",
      generatedAt: now.toISOString(),
      context: {
        contextType: this.contextType,
        location: unavailable
          ? {
              available: false,
              latitude: null,
              longitude: null,
              resolvedFrom: null,
              unitId: this.contextType === "SELECTED_TARGET" ? null : "cbwx-unit-striker",
              unitPositionObservedAt: null,
              unitPositionHealthState: this.scenario === "unavailable_unit_location" ? "OFFLINE" : null,
              headingDeg: null,
              distanceMiles: this.contextType === "AHEAD_OF_UNIT" ? 20 : null,
              unavailableReason:
                this.scenario === "unavailable_unit_location"
                  ? "No current position is available for this unit."
                  : "Simulated upstream provider failure.",
            }
          : {
              available: true,
              latitude: 35.22,
              longitude: -97.44,
              resolvedFrom:
                this.contextType === "AT_UNIT"
                  ? "unit_position"
                  : this.contextType === "AHEAD_OF_UNIT"
                    ? "projected_position"
                    : "explicit_target",
              unitId: this.contextType === "SELECTED_TARGET" ? null : "cbwx-unit-striker",
              unitPositionObservedAt: now.toISOString(),
              unitPositionHealthState: this.contextType === "SELECTED_TARGET" ? null : "LIVE",
              headingDeg: this.contextType === "AHEAD_OF_UNIT" ? 224 : null,
              distanceMiles: this.contextType === "AHEAD_OF_UNIT" ? 20 : null,
              unavailableReason: null,
            },
        requestedAt: now.toISOString(),
      },
      providerName: "simulation",
      simulation: true,
      metrics,
      score,
      canonicalUnits: {},
      available: !unavailable,
      unavailableReason: unavailable
        ? this.scenario === "unavailable_unit_location"
          ? "No current position is available for this unit."
          : "Simulated upstream provider failure."
        : null,
    };

    return {
      contextType: this.contextType,
      scenario: this.scenario,
      snapshot,
      hodograph,
      publicLocation,
      takeover: this.takeover,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): OverlayState {
    return this.snapshot;
  }

  setContextType(contextType: ContextType): void {
    this.contextType = contextType;
    this.snapshot = this.compute();
    this.emit();
  }

  setScenario(scenario: SimulationScenario): void {
    this.scenario = scenario;
    this.snapshot = this.compute();
    this.emit();
  }

  triggerTakeover(kind: EventTakeoverKind): void {
    if (this.takeoverTimer) clearTimeout(this.takeoverTimer);
    const config = TAKEOVER_HEADLINES[kind];
    const takeover: EventTakeover = {
      id: `${kind}-${Date.now()}`,
      kind,
      headline: config.headline,
      detail: config.detail,
      issuedAt: new Date().toISOString(),
      holdMs: config.holdMs,
    };
    this.takeover = takeover;
    this.snapshot = { ...this.snapshot, takeover };
    this.emit();
    this.takeoverTimer = setTimeout(() => {
      this.dismissTakeover();
    }, config.holdMs);
  }

  dismissTakeover(): void {
    if (this.takeoverTimer) {
      clearTimeout(this.takeoverTimer);
      this.takeoverTimer = null;
    }
    this.takeover = null;
    this.snapshot = { ...this.snapshot, takeover: null };
    this.emit();
  }

  disconnect(): void {
    clearInterval(this.tickTimer);
    if (this.takeoverTimer) clearTimeout(this.takeoverTimer);
    this.listeners.clear();
  }
}
