import { useEffect, useState } from "react";
import { formatMetricValue, formatTrend } from "../utils/format";
import type { MetricKey, NormalizedMetric, StormIntelSnapshot } from "../stormIntel/types";
import "./FeaturedMetricBay.css";

// Priority order for the rotating featured slot -- most tornado-relevant first.
const FEATURED_ORDER: { key: MetricKey; short: string }[] = [
  { key: "significant_tornado_parameter", short: "STP" },
  { key: "supercell_composite_parameter", short: "SCP" },
  { key: "mlcape", short: "MLCAPE" },
  { key: "bulk_shear_0_6km", short: "0-6KM SHEAR" },
  { key: "srh_0_1km", short: "0-1KM SRH" },
  { key: "lcl_height", short: "LCL" },
  { key: "lapse_rate_0_3km", short: "0-3KM LAPSE" },
];

const SECONDARY: { key: MetricKey; short: string }[] = [
  { key: "surface_temperature", short: "TEMP" },
  { key: "surface_dewpoint", short: "DEWPT" },
  { key: "sbcin", short: "CIN" },
  { key: "relative_humidity", short: "RH" },
];

const ROTATE_MS = 6000;

function find(metrics: NormalizedMetric[], key: MetricKey): NormalizedMetric | undefined {
  return metrics.find((m) => m.key === key);
}

export function FeaturedMetricBay({ snapshot }: { snapshot: StormIntelSnapshot }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((prev) => (prev + 1) % FEATURED_ORDER.length), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  if (!snapshot.available) {
    return (
      <div className="fmb">
        <div className="fmb__unavailable">
          <span className="cb-kicker">STORM INTEL</span>
          <span className="fmb__unavailable-reason">{snapshot.unavailableReason ?? "No data."}</span>
        </div>
      </div>
    );
  }

  const featured = FEATURED_ORDER[index];
  const metric = find(snapshot.metrics, featured.key);
  const unavailable = !metric || metric.availability === "unavailable";
  const trend = metric ? formatTrend(metric) : null;

  return (
    <div className="fmb">
      <div key={featured.key} className="fmb__featured cb-wipe-in">
        <span className="cb-label">{featured.short}</span>
        <span className={`fmb__value${unavailable ? " fmb__value--unavailable" : ""}`}>
          {metric ? formatMetricValue(metric) : "--"}
          {!unavailable && metric?.unit && <span className="fmb__unit">{metric.unit}</span>}
          {trend && <span className="fmb__trend">{trend}</span>}
        </span>
        {metric?.source?.formulation && <span className="fmb__formulation">{metric.source.formulation}</span>}
      </div>

      <div className="fmb__dots" aria-hidden="true">
        {FEATURED_ORDER.map((item, i) => (
          <span key={item.key} className={`fmb__dot${i === index ? " fmb__dot--active" : ""}`} />
        ))}
      </div>

      <div className="fmb__secondary">
        {SECONDARY.map((item) => {
          const m = find(snapshot.metrics, item.key);
          const u = !m || m.availability === "unavailable";
          return (
            <div key={item.key} className={`fmb__secondary-item${u ? " fmb__secondary-item--unavailable" : ""}`}>
              <span className="cb-label">{item.short}</span>
              <span className="cb-value fmb__secondary-value">{m ? formatMetricValue(m) : "--"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
