import type { LiveConfig } from "../config/liveConfig";
import { fetchStormIntelSnapshot, StormIntelTransportError } from "./restClient";
import { TakeoverController } from "./takeoverController";
import type {
  ContextType,
  EventTakeoverKind,
  HodographData,
  OverlayState,
  SimulationScenario,
  StormIntelProvider,
  StormIntelSnapshot,
} from "./types";
import { StormIntelSocket, type StormIntelSocketStatus } from "./wsClient";

function unavailableSnapshot(contextType: ContextType, reason: string, now: Date): StormIntelSnapshot {
  return {
    schema: "codeblack.storm-intel.snapshot",
    schemaVersion: "1.0.0",
    generatedAt: now.toISOString(),
    context: {
      contextType,
      location: {
        available: false,
        latitude: null,
        longitude: null,
        resolvedFrom: null,
        unitId: null,
        unitPositionObservedAt: null,
        unitPositionHealthState: null,
        headingDeg: null,
        distanceMiles: null,
        unavailableReason: reason,
      },
      requestedAt: now.toISOString(),
    },
    providerName: "live-core",
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
  };
}

// Core's Storm Intel schema has no raw vertical wind profile yet (confirmed against the real
// models.py -- see docs/design/overlay-data-flow-audit.md, part 3/G). Live mode always shows the
// hodograph as unavailable rather than partially wiring the SRH/shear numbers that DO exist on
// the snapshot through a component contract built for a full profile-or-nothing render.
function unavailableHodograph(): HodographData {
  return { levels: [], srh01: null, srh03: null, shear06: null, source: null, freshness: "unavailable", simulation: false };
}

/**
 * Live Core Storm Intel provider: REST bootstrap for first paint, then WebSocket push for
 * ongoing updates. Implements the same `StormIntelProvider` interface `StormIntelSimulator` does,
 * so `store.ts` can swap between them without any component change -- the seam the original
 * `types.ts` docstring described.
 */
export class RestStormIntelProvider implements StormIntelProvider {
  private listeners = new Set<() => void>();
  private contextType: ContextType;
  private socket: StormIntelSocket | null = null;
  private takeoverController = new TakeoverController(() => {
    this.snapshot = { ...this.snapshot, takeover: this.takeoverController.get() };
    this.emit();
  });
  private snapshot: OverlayState;
  private connectionStatus: StormIntelSocketStatus = "connecting";
  private disposed = false;

  constructor(private config: LiveConfig) {
    this.contextType = config.contextType;
    this.snapshot = {
      contextType: this.contextType,
      scenario: "low_end",
      snapshot: unavailableSnapshot(this.contextType, "Connecting to CodeBlack-Core...", new Date()),
      hodograph: unavailableHodograph(),
      publicLocation: null,
      takeover: null,
    };
    this.bootstrap();
  }

  private bootstrap(): void {
    fetchStormIntelSnapshot(this.config)
      .then((snapshot) => {
        if (this.disposed) return;
        this.applySnapshot(snapshot);
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        const reason = error instanceof StormIntelTransportError ? error.message : "CodeBlack-Core unreachable.";
        this.applyUnavailable(reason);
      });
    this.connectSocket();
  }

  private connectSocket(): void {
    this.socket = new StormIntelSocket(this.config, {
      onEvent: (event) => {
        if (this.disposed) return;
        this.applySnapshot(event.snapshot);
      },
      onStatusChange: (status) => {
        if (this.disposed) return;
        this.connectionStatus = status;
        if (status === "stale" || status === "closed") {
          // Never freeze the last-known snapshot's freshness indefinitely once the connection
          // itself is known dead -- surface that explicitly instead of a silently aging badge.
          this.applyUnavailable("Live Core connection lost. Reconnecting...");
        }
      },
      onMalformedMessage: () => {
        // Connection stays up; the one bad message is dropped. Nothing to do here -- the last
        // good snapshot (or the "unavailable" placeholder) remains visible.
      },
    });
    this.socket.start();
  }

  private applySnapshot(snapshot: StormIntelSnapshot): void {
    this.snapshot = {
      ...this.snapshot,
      contextType: this.contextType,
      snapshot,
      hodograph: unavailableHodograph(),
      takeover: this.takeoverController.get(),
    };
    this.emit();
  }

  private applyUnavailable(reason: string): void {
    this.snapshot = {
      ...this.snapshot,
      snapshot: unavailableSnapshot(this.contextType, reason, new Date()),
      hodograph: unavailableHodograph(),
      takeover: this.takeoverController.get(),
    };
    this.emit();
  }

  getConnectionStatus(): StormIntelSocketStatus {
    return this.connectionStatus;
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
    this.config = { ...this.config, contextType };
    this.socket?.stop();
    this.applyUnavailable("Switching context...");
    this.connectSocket();
    fetchStormIntelSnapshot(this.config)
      .then((snapshot) => {
        if (this.disposed) return;
        this.applySnapshot(snapshot);
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        const reason = error instanceof StormIntelTransportError ? error.message : "CodeBlack-Core unreachable.";
        this.applyUnavailable(reason);
      });
  }

  /** Simulation-only concept -- Core has no "scenario" selection. Intentional no-op in live mode. */
  setScenario(_scenario: SimulationScenario): void {
    // no-op by design
  }

  triggerTakeover(kind: EventTakeoverKind): void {
    this.takeoverController.trigger(kind);
  }

  dismissTakeover(): void {
    this.takeoverController.dismiss();
  }

  disconnect(): void {
    this.disposed = true;
    this.socket?.stop();
    this.takeoverController.disconnect();
    this.listeners.clear();
  }
}
