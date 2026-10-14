import type { WeightedSynthesis } from "./setupReviewModel";
import { WEIGHT_LABELS } from "./setupWeightModel";

const label = (value: string) => WEIGHT_LABELS[value as keyof typeof WEIGHT_LABELS] ?? value.replaceAll("_", " ");
const state = (value?: string) => (value ?? "unavailable").replaceAll("_", " ");

export function SetupSynthesis({ synthesis, compact = false }: { synthesis?: WeightedSynthesis | null; compact?: boolean }) {
  if (!synthesis) return <section className="setup-synthesis"><h3>Weighted synthesis</h3><p>Synthesis is unavailable for this retained revision.</p></section>;
  const active = synthesis.contributions.filter(row => row.available && row.available_influence_bp > 0);
  return <section className={`setup-synthesis${compact ? " setup-synthesis--compact" : ""}`}>
    <header><div><h3>Weighted synthesis</h3><p>Evidence coverage {synthesis.coverage_percent.toFixed(1)}% · not forecast confidence</p></div><span>{active.length} weighted inputs ready</span></header>
    <div className="setup-synthesis__bar" aria-label={`Configured evidence coverage ${synthesis.coverage_percent.toFixed(1)} percent`}><i style={{ width: `${synthesis.coverage_percent}%` }} /></div>
    <div className="setup-synthesis__chips">{synthesis.contributions.map(row => <span key={row.source} data-ready={row.available} title={row.detail}>
      {label(row.source)} <b>{row.available ? `${(row.available_influence_bp / 10).toFixed(1)}%` : "missing"}</b>
    </span>)}</div>
    {!compact && <>
      <div className="setup-synthesis__matrix"><section><h4>Forecast matrix</h4>{synthesis.model_matrix.map(row => <div key={row.source}><strong>{row.source.toUpperCase()}</strong><span data-ready={row.status === "available"}>{state(row.status)}</span><small>{row.sampled_hours == null ? row.role ?? "context" : `${row.sampled_hours} sampled times · ${row.fields.length} fields`}{row.ensemble_complete === false ? " · incomplete ensemble" : ""}</small></div>)}</section>
      <section><h4>Observed & official</h4>{synthesis.observation_matrix.map(row => <div key={row.source}><strong>{label(row.source)}</strong><span data-ready={["available", "AVAILABLE", "current_observation_available"].includes(row.status)}>{state(row.status)}</span><small>{row.count} returned item{row.count === 1 ? "" : "s"}{row.freshness ? ` · ${row.freshness}` : ""}</small></div>)}</section></div>
      {synthesis.corridor_support.length > 0 && <div className="setup-synthesis__corridor"><h4>Target-corridor source support</h4>{synthesis.corridor_support.map((row, index) => <p key={`${row.latitude}:${row.longitude}:${index}`}><strong>{row.latitude.toFixed(3)}, {row.longitude.toFixed(3)}</strong> · {row.supporting_sources.map(source => source.toUpperCase()).join(" + ")} <small>Source presence only; not hazard consensus.</small></p>)}</div>}
      <p className="setup-synthesis__notice">{synthesis.explanation}</p>
    </>}
  </section>;
}
