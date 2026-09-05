import { useEffect, useRef, useState } from "react";
import { presentFreshness } from "../utils/freshness";
import { formatAge, formatScore } from "../utils/format";
import { FeaturedMetricBay } from "./FeaturedMetricBay";
import { Hodograph } from "./Hodograph";
import type { OverlayState } from "../stormIntel/types";
import "./CommandRail.css";

function scoreTier(value: number | null): "low" | "mid" | "high" | "extreme" | "none" {
  if (value === null) return "none";
  if (value >= 7.5) return "extreme";
  if (value >= 5) return "high";
  if (value >= 2.5) return "mid";
  return "low";
}

export function CommandRail({ state }: { state: OverlayState }) {
  const { snapshot, publicLocation, hodograph } = state;
  const { score } = snapshot;
  const overallFreshness = presentFreshness(snapshot.metrics[0]?.freshness ?? "unknown");
  const worstAge = snapshot.metrics[0]?.ageSeconds ?? null;

  // Urgency that decays: a single flash on the transition into "stale" -- never a constant pulse.
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
        <section className="rail-block rail-identity">
          <span className="cb-kicker">CODE BLACK WX</span>
          <span className="rail-identity__city">
            {publicLocation ? `${publicLocation.city}, ${publicLocation.state}` : "LOCATION UNAVAILABLE"}
          </span>
          {publicLocation?.elevationFt != null && (
            <span className="rail-identity__elev cb-mono">{publicLocation.elevationFt.toLocaleString()} ft</span>
          )}
        </section>

        <div className="rail-divider" />

        <FeaturedMetricBay snapshot={snapshot} />

        <div className="rail-divider" />

        <section className="rail-block rail-score">
          <span className="cb-label">STORM ENV</span>
          <span className="rail-score__value" data-tier={scoreTier(score.value)}>
            {formatScore(score.value)}
            <span className="rail-score__max">/10</span>
          </span>
        </section>

        <div className="rail-divider" />

        <section className="rail-block rail-status">
          <span className={`rail-status__dot ${overallFreshness.className}${flashStale ? " cb-flash-once" : ""}`} />
          <span className="rail-status__label">{overallFreshness.label}</span>
          <span className="rail-status__age cb-mono">{formatAge(worstAge)}</span>
          {snapshot.simulation && <span className="rail-sim-badge">SIM</span>}
          {publicLocation?.nearbyChaserCount != null && (
            <span className="rail-status__chasers">{publicLocation.nearbyChaserCount} nearby</span>
          )}
        </section>
      </div>
    </div>
  );
}
