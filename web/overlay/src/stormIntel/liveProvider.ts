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
  private restPollTimer: ReturnType<typeof setInterval> | null = null;
  private wsEverOpened = false;

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
    this.startRestPolling();
  }

  // WS push is the fast path, but there is no guarantee it's actually reachable in every
  // deployment (e.g. it may have no working transport at all in front of it yet) -- without
  // this, a WS that never connects leaves the overlay stuck showing "connection lost" over what
  // would otherwise be perfectly good data, forever. This polls the same REST endpoint the
  // bootstrap uses on a `pollSeconds` cadence as an independent heartbeat: WS staleness still
  // marks the snapshot unavailable immediately (never silently freezing old data, per the
  // existing behavior below), but real data reliably reappears at the next successful poll
  // rather than requiring WS to ever work at all. Reads `this.config` fresh on every tick, so a
  // setContextType() mid-flight is picked up without needing to restart this timer.
  private startRestPolling(): void {
    if (this.restPollTimer) clearInterval(this.restPollTimer);
    const intervalMs = Math.max(5, this.config.pollSeconds) * 1000;
    this.restPollTimer = setInterval(() => {
      if (this.disposed) return;
      fetchStormIntelSnapshot(this.config)
        .then((snapshot) => {
          if (this.disposed) return;
          this.applySnapshot(snapshot);
        })
        .catch(() => {
          // A single missed poll isn't reported as unavailable on its own -- WS status (when a
          // WS transport exists) or the next successful poll already covers a genuine outage.
        });
    }, intervalMs);
  }

  private connectSocket(): void {
    this.socket = new StormIntelSocket(this.config, {
      onEvent: (event) => {
        if (this.disposed) return;
        this.wsEverOpened = true;
        this.applySnapshot(event.snapshot);
      },
      onStatusChange: (status) => {
        if (this.disposed) return;
        this.connectionStatus = status;
        if (status === "open") this.wsEverOpened = true;
        // Only a regression -- a socket that DID work and then went stale/closed -- blanks the
        // display; never freeze that kind of dead connection's last-known snapshot silently.
        // A socket that has never once opened (no WS transport in front of Core at all, e.g.
        // this deployment today) retries forever and would otherwise re-blank real data on every
        // failed retry, faster than REST polling below can refresh it -- REST alone is the
        // steady-state truth for a deployment that was never really WS-connected to begin with.
        if ((status === "stale" || status === "closed") && this.wsEverOpened) {
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
    if (this.restPollTimer) clearInterval(this.restPollTimer);
    this.takeoverController.disconnect();
    this.listeners.clear();
  }
}
