import type { EventTakeover, EventTakeoverKind } from "./types";

/**
 * Core has no watch/warning/takeover concept in its schema yet (confirmed against the real
 * `storm_intel/models.py` -- see `docs/design/overlay-data-flow-audit.md`), so takeover firing
 * stays a manually/dev-triggered concern in every mode, including LIVE_CORE. This table is shared
 * (not duplicated) between `StormIntelSimulator` and `RestStormIntelProvider` so both behave
 * identically until Core grows a real warning feed.
 */
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

export class TakeoverController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: EventTakeover | null = null;

  constructor(private readonly onChange: (takeover: EventTakeover | null) => void) {}

  get(): EventTakeover | null {
    return this.current;
  }

  trigger(kind: EventTakeoverKind): void {
    if (this.timer) clearTimeout(this.timer);
    const config = TAKEOVER_HEADLINES[kind];
    this.current = {
      id: `${kind}-${Date.now()}`,
      kind,
      headline: config.headline,
      detail: config.detail,
      issuedAt: new Date().toISOString(),
      holdMs: config.holdMs,
    };
    this.onChange(this.current);
    this.timer = setTimeout(() => this.dismiss(), config.holdMs);
  }

  dismiss(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.current = null;
    this.onChange(null);
  }

  disconnect(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
