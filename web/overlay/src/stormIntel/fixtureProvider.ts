import { TakeoverController } from "./takeoverController";
import type { ContextType, EventTakeoverKind, OverlayState, SimulationScenario, StormIntelProvider } from "./types";

/** One recorded, already-normalized `OverlayState` frame plus how long to hold it before
 * advancing -- the shape every `fixtures/*.json` file uses. */
export interface FixtureFrame {
  holdMs: number;
  state: OverlayState;
}

export interface FixtureSequence {
  name: string;
  description: string;
  frames: FixtureFrame[];
  /** When true, loops back to frame 0 after the last frame; otherwise holds on the last frame. */
  loop: boolean;
}

/**
 * Replays a recorded, already-normalized frame sequence with no Core connection required --
 * the preferred reproducible visual-QA mechanism (`docs/design/overlay-live-data-integration.md`).
 * Every frame is data a real adapter would have already produced; this provider does no
 * additional simulation math of its own, unlike `StormIntelSimulator`.
 */
export class FixtureStormIntelProvider implements StormIntelProvider {
  private listeners = new Set<() => void>();
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: OverlayState;
  private takeoverController = new TakeoverController(() => {
    this.snapshot = { ...this.snapshot, takeover: this.takeoverController.get() };
    this.emit();
  });

  constructor(private readonly sequence: FixtureSequence) {
    if (sequence.frames.length === 0) {
      throw new Error(`fixture "${sequence.name}" has no frames`);
    }
    this.snapshot = sequence.frames[0].state;
    this.scheduleNext();
  }

  private scheduleNext(): void {
    const frame = this.sequence.frames[this.index];
    this.timer = setTimeout(() => {
      this.advance();
    }, frame.holdMs);
  }

  private advance(): void {
    const atLast = this.index >= this.sequence.frames.length - 1;
    if (atLast) {
      if (!this.sequence.loop) return;
      this.index = 0;
    } else {
      this.index += 1;
    }
    this.snapshot = this.sequence.frames[this.index].state;
    this.emit();
    this.scheduleNext();
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

  /** Fixtures are pre-recorded per named sequence, not per-context -- no-op by design. */
  setContextType(_contextType: ContextType): void {
    // no-op by design
  }

  /** Fixtures replace scenario selection entirely -- no-op by design. */
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
    if (this.timer) clearTimeout(this.timer);
    this.takeoverController.disconnect();
    this.listeners.clear();
  }
}
