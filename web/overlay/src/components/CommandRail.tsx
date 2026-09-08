import { useEffect, useRef, useState } from "react";
import { presentFreshness } from "../utils/freshness";
import { formatAge, formatHeading, formatScore } from "../utils/format";
import { Clock } from "./Clock";
import { FeaturedMetricBay } from "./FeaturedMetricBay";
import { Hodograph } from "./Hodograph";
import type { EventTakeoverKind, OverlayState } from "../stormIntel/types";
import "./CommandRail.css";

const ALERT_CHIP_CLASS: Record<EventTakeoverKind, string> = {
  TOR_WARNING: "rail-alert--tor-warning",
  SVR_WARNING: "rail-alert--svr-warning",
  MESO_DISCUSSION: "rail-alert--meso",
  TOR_WATCH: "rail-alert--tor-watch",
  PDS_TOR_WATCH: "rail-alert--pds-watch",
  OBSERVED_TORNADO: "rail-alert--observed",
};

function scoreTier(value: number | null): "low" | "mid" | "high" | "extreme" | "none" {
  if (value === null) return "none";
  if (value >= 7.5) return "extreme";
  if (value >= 5) return "high";
  if (value >= 2.5) return "mid";
  return "low";
}

export function CommandRail({ state }: { state: OverlayState }) {
  const { snapshot, publicLocation, hodograph, takeover } = state;
  const { score } = snapshot;
  const heading = snapshot.context.location.headingDeg;
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
          <span className="rail-identity__heading cb-mono">
            {heading !== null ? `${formatHeading(heading)} ${Math.round(heading)}°` : "HEADING --"}
          </span>
          {publicLocation?.elevationFt != null && (
            <span className="rail-identity__elev cb-mono">{publicLocation.elevationFt.toLocaleString()} ft</span>
          )}
        </section>

        <div className="rail-divider" />

        {takeover && (
          <>
            <section className={`rail-block rail-alert ${ALERT_CHIP_CLASS[takeover.kind]}`}>
              <span className="rail-alert__text">{takeover.headline}</span>
            </section>
            <div className="rail-divider" />
          </>
        )}

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

        <div className="rail-divider" />

        <Clock />
      </div>
    </div>
  );
}
