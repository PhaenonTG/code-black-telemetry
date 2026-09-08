import { useEffect, useRef, useState } from "react";
import { presentFreshness } from "../utils/freshness";
import { formatAge, formatScore } from "../utils/format";
import { FeaturedMetricBay } from "./FeaturedMetricBay";
import { Hodograph } from "./Hodograph";
import { Clock } from "./Clock";
import type { OverlayState } from "../stormIntel/types";
import "./CommandRail.css";

function scoreTier(value: number | null): "low" | "mid" | "high" | "extreme" | "none" {
  if (value === null) return "none";
  if (value >= 7.5) return "extreme";
  if (value >= 5) return "high";
  if (value >= 2.5) return "mid";
  return "low";
}

// Right-anchored intel bar -- identity now lives on CallsignCard (bottom-left) and the current
// alert on AlertRibbon (its own full-width strip), so this is purely the data readout: a hero
// Storm Env score (the single most legible number for a viewer who isn't a meteorologist),
// the rotating metric ticker, freshness/staleness, and the clock.
export function CommandRail({ state }: { state: OverlayState }) {
  const { snapshot, hodograph } = state;
  const { score } = snapshot;
  const overallFreshness = presentFreshness(snapshot.metrics[0]?.freshness ?? "unknown");
  const worstAge = snapshot.metrics[0]?.ageSeconds ?? null;

  const [flashStale, setFlashStale] = useState(false);
  const prevFreshnessClass = useRef(overallFreshness.className);
  useEffect(() => {
    if (prevFreshnessClass.current !== overallFreshness.className) {
      prevFreshnessClass.current = overallFreshness.className;
      if (overallFreshness.className === "freshness-stale") {
        setFlashStale(true);
        const timer = setTimeout(() => setFlashStale(false), 1900);
        return () => clearTimeout(timer);
      }
    }
  }, [overallFreshness.className]);

  return (
    <div className="command-rail">
      <Hodograph data={hodograph} />

      <div className="cb-chassis rail-main">
        <section className="rail-block rail-score">
          <span className="cb-label">STORM ENV</span>
          <span className="rail-score__value" data-tier={scoreTier(score.value)}>
            {formatScore(score.value)}
            <span className="rail-score__max">/10</span>
          </span>
        </section>

        <div className="rail-divider" />

        <FeaturedMetricBay snapshot={snapshot} />

        <div className="rail-divider" />

        <section className="rail-block rail-status">
          <span className={`rail-status__dot ${overallFreshness.className}${flashStale ? " cb-flash-once" : ""}`} />
          <span className="rail-status__label">{overallFreshness.label}</span>
          <span className="rail-status__age cb-mono">{formatAge(worstAge)}</span>
          {snapshot.simulation && <span className="rail-sim-badge">SIM</span>}
        </section>

        <div className="rail-divider" />

        <Clock />
      </div>
    </div>
  );
}
