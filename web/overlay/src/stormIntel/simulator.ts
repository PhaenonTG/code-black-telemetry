import {
  buildHodograph,
  buildMetrics,
  publicLocationFor,
  scoreFromMetrics,
} from "./scenarios";
import { TakeoverController } from "./takeoverController";
import type {
  ContextType,
  EventTakeoverKind,
  OverlayState,
  SimulationScenario,
  StormIntelProvider,
  StormIntelSnapshot,
} from "./types";

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
  private takeoverController = new TakeoverController(() => {
    this.snapshot = { ...this.snapshot, takeover: this.takeoverController.get() };
    this.emit();
  });
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
      takeover: this.takeoverController.get(),
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
    this.takeoverController.trigger(kind);
  }

  dismissTakeover(): void {
    this.takeoverController.dismiss();
  }

  disconnect(): void {
    clearInterval(this.tickTimer);
    this.takeoverController.disconnect();
    this.listeners.clear();
  }
}
