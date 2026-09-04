import type { StormIntelFreshness } from "../stormIntel/types";

export interface FreshnessPresentation {
  label: string;
  className: string;
}

/**
 * Presentation mapping only -- classification itself always happens
 * upstream (Core's `classify_storm_intel_freshness` today; this
 * simulator's `buildMetrics` in dev). Never re-derive freshness from raw
 * timestamps in a component.
 */
export function presentFreshness(freshness: StormIntelFreshness): FreshnessPresentation {
  switch (freshness) {
    case "current":
      return { label: "CURRENT", className: "freshness-current" };
    case "aging":
      return { label: "AGING", className: "freshness-aging" };
    case "stale":
      return { label: "STALE", className: "freshness-stale" };
    case "unavailable":
      return { label: "UNAVAILABLE", className: "freshness-unavailable" };
    case "unknown":
    default:
      return { label: "UNKNOWN", className: "freshness-unknown" };
  }
}
