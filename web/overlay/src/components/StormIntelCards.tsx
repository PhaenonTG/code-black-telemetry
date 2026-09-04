import { useEffect, useState } from "react";
import { presentFreshness } from "../utils/freshness";
import { formatMetricValue, formatScore, formatTrend } from "../utils/format";
import type { NormalizedMetric, StormIntelSnapshot } from "../stormIntel/types";
import "./StormIntelCards.css";

type CardId = "environment" | "instability" | "kinematics" | "moisture" | "lapse" | "composite";

const ROTATION: { id: CardId; title: string }[] = [
  { id: "environment", title: "STORM ENVIRONMENT" },
  { id: "instability", title: "INSTABILITY" },
  { id: "kinematics", title: "KINEMATICS" },
  { id: "moisture", title: "MOISTURE / BASE" },
  { id: "lapse", title: "LAPSE RATES" },
  { id: "composite", title: "COMPOSITE PARAMETERS" },
];

const ROTATE_MS = 6000;

function find(metrics: NormalizedMetric[], key: string): NormalizedMetric | undefined {
  return metrics.find((m) => m.key === key);
}

export function StormIntelCards({ snapshot }: { snapshot: StormIntelSnapshot }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((prev) => (prev + 1) % ROTATION.length), ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const active = ROTATION[index];

  return (
    <div className="si-cards" aria-live="polite">
      <div key={active.id} className="si-card">
        <CardHeader title={active.title} snapshot={snapshot} />
        <CardBody id={active.id} snapshot={snapshot} />
        <div className="si-card__dots">
          {ROTATION.map((item, i) => (
            <span key={item.id} className={`si-dot${i === index ? " si-dot--active" : ""}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CardHeader({ title, snapshot }: { title: string; snapshot: StormIntelSnapshot }) {
  const first = snapshot.metrics[0];
  const fresh = presentFreshness(first?.freshness ?? "unknown");
  return (
    <div className="si-card__header">
      <span className="si-card__title">{title}</span>
      <span className={`si-card__fresh ${fresh.className}`}>{fresh.label}</span>
    </div>
  );
}

function CardBody({ id, snapshot }: { id: CardId; snapshot: StormIntelSnapshot }) {
  if (!snapshot.available) {
    return (
      <div className="si-card__unavailable">
        <span>UNAVAILABLE</span>
        <span className="si-card__reason">{snapshot.unavailableReason ?? "No data."}</span>
      </div>
    );
  }

  if (id === "environment") {
    const score = snapshot.score;
    return (
      <div className="si-card__body si-card__body--score">
        <div className="si-score-big" data-available={score.available}>
          {formatScore(score.value)}
          <span className="si-score-big__max">/10</span>
        </div>
        <div className="si-score-note">
          {score.available ? "Code Black-derived, experimental" : score.unavailableReason}
        </div>
      </div>
    );
  }

  const rows: { label: string; key: string }[] =
    id === "instability"
      ? [
          { label: "SBCAPE", key: "sbcape" },
          { label: "MLCAPE", key: "mlcape" },
          { label: "MUCAPE", key: "mucape" },
          { label: "SBCIN", key: "sbcin" },
          { label: "MLCIN", key: "mlcin" },
          { label: "MUCIN", key: "mucin" },
        ]
      : id === "kinematics"
        ? [
            { label: "0-1km SRH", key: "srh_0_1km" },
            { label: "0-3km SRH", key: "srh_0_3km" },
            { label: "0-6km Shear", key: "bulk_shear_0_6km" },
          ]
        : id === "moisture"
          ? [
              { label: "Temp", key: "surface_temperature" },
              { label: "Dewpoint", key: "surface_dewpoint" },
              { label: "RH", key: "relative_humidity" },
              { label: "LCL", key: "lcl_height" },
            ]
          : id === "lapse"
            ? [
                { label: "0-3km", key: "lapse_rate_0_3km" },
                { label: "700-500mb", key: "lapse_rate_700_500mb" },
              ]
            : [
                { label: "STP", key: "significant_tornado_parameter" },
                { label: "SCP", key: "supercell_composite_parameter" },
              ];

  return (
    <div className="si-card__body">
      {rows.map((row) => {
        const metric = find(snapshot.metrics, row.key);
        const unavailable = !metric || metric.availability === "unavailable";
        const trend = metric ? formatTrend(metric) : null;
        return (
          <div key={row.key} className={`si-row${unavailable ? " si-row--unavailable" : ""}`}>
            <span className="si-row__label">{row.label}</span>
            <span className="si-row__value">
              {metric ? formatMetricValue(metric) : "--"}
              {!unavailable && metric?.unit && <span className="si-row__unit">{metric.unit}</span>}
              {trend && <span className="si-row__trend">{trend}</span>}
            </span>
            {metric?.source?.formulation && id === "composite" && (
              <span className="si-row__formulation">{metric.source.formulation}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
