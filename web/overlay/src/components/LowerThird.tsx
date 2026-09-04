import { presentFreshness } from "../utils/freshness";
import { formatAge, formatMetricValue, formatScore } from "../utils/format";
import type { NormalizedMetric, OverlayState } from "../stormIntel/types";
import "./LowerThird.css";

function metric(metrics: NormalizedMetric[], key: string): NormalizedMetric | undefined {
  return metrics.find((m) => m.key === key);
}

export function LowerThird({ state }: { state: OverlayState }) {
  const { snapshot, publicLocation } = state;
  const { metrics, score } = snapshot;

  const temperature = metric(metrics, "surface_temperature");
  const dewpoint = metric(metrics, "surface_dewpoint");
  const mlcape = metric(metrics, "mlcape");
  const sbcin = metric(metrics, "sbcin");
  const srh01 = metric(metrics, "srh_0_1km");
  const shear06 = metric(metrics, "bulk_shear_0_6km");
  const overallFreshness = presentFreshness(temperature?.freshness ?? "unknown");
  const worstAge = temperature?.ageSeconds ?? null;

  return (
    <div className="lower-third" role="status" aria-label="Storm Intel status strip">
      <div className="lower-third__glass">
        <section className="lt-block lt-location">
          <span className="lt-location__city">
            {publicLocation ? `${publicLocation.city}, ${publicLocation.state}` : "LOCATION UNAVAILABLE"}
          </span>
          {publicLocation?.elevationFt != null && (
            <span className="lt-location__elev">{publicLocation.elevationFt.toLocaleString()} ft</span>
          )}
        </section>

        <div className="lt-divider" />

        <section className="lt-block lt-metrics">
          <MetricPair label="TEMP" metric={temperature} suffix="°F" />
          <MetricPair label="DEWPT" metric={dewpoint} suffix="°F" />
          <MetricPair label="MLCAPE" metric={mlcape} suffix="J/kg" />
          <MetricPair label="CIN" metric={sbcin} suffix="J/kg" />
          <MetricPair label="0-1SRH" metric={srh01} suffix="m²/s²" />
          <MetricPair label="0-6SHR" metric={shear06} suffix="kt" />
        </section>

        <div className="lt-divider" />

        <section className="lt-block lt-score">
          <span className="lt-score__label">STORM ENV</span>
          <span className="lt-score__value" data-tier={scoreTier(score.value)}>
            {formatScore(score.value)}
            <span className="lt-score__max">/10</span>
          </span>
          <span className="lt-score__tag">EXPERIMENTAL</span>
        </section>

        <div className="lt-divider" />

        <section className="lt-block lt-status">
          <span className={`lt-freshness-dot ${overallFreshness.className}`} />
          <span className="lt-status__label">{overallFreshness.label}</span>
          <span className="lt-status__age">{formatAge(worstAge)}</span>
          {snapshot.simulation && <span className="lt-sim-badge">SIM</span>}
          {publicLocation?.nearbyChaserCount != null && (
            <span className="lt-chasers">{publicLocation.nearbyChaserCount} nearby</span>
          )}
        </section>
      </div>
    </div>
  );
}

function scoreTier(value: number | null): "low" | "mid" | "high" | "extreme" | "none" {
  if (value === null) return "none";
  if (value >= 7.5) return "extreme";
  if (value >= 5) return "high";
  if (value >= 2.5) return "mid";
  return "low";
}

function MetricPair({
  label,
  metric,
  suffix,
}: {
  label: string;
  metric: NormalizedMetric | undefined;
  suffix: string;
}) {
  const unavailable = !metric || metric.availability === "unavailable";
  return (
    <div className={`lt-metric${unavailable ? " lt-metric--unavailable" : ""}`}>
      <span className="lt-metric__label">{label}</span>
      <span className="lt-metric__value">
        {metric ? formatMetricValue(metric) : "--"}
        {!unavailable && <span className="lt-metric__unit">{suffix}</span>}
      </span>
    </div>
  );
}
