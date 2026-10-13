import { useState } from "react";
import type { SetupWeightBinding, SetupWeightPolicy } from "./setupReviewModel";
import { EVIDENCE_WEIGHT_SOURCES, REVIEW_WEIGHT_SOURCES, samePolicy, setWeight, validPolicyTotals, WEIGHT_LABELS, weightTotal } from "./setupWeightModel";

function WeightGroup<T extends string>({ title, keys, weights, onChange }: {
  title: string; keys: readonly T[]; weights: Record<T, number>; onChange: (key: T, percent: number) => void;
}) {
  const total = weightTotal(weights);
  return <fieldset className="setup-weight-tuner__group">
    <legend>{title}<span data-valid={total === 1000}>{(total / 10).toFixed(1)}%</span></legend>
    <div className="setup-weight-tuner__grid">{keys.map(key => <label key={key}>
      <span>{WEIGHT_LABELS[key as keyof typeof WEIGHT_LABELS]}</span>
      <span className="setup-weight-tuner__input"><input type="number" min="0" max="100" step="0.5"
        value={(weights[key] / 10).toFixed(1)} onChange={event => onChange(key, Number(event.target.value))} /><small>%</small></span>
    </label>)}</div>
  </fieldset>;
}

export function SetupWeightTuner({ binding, current, authorized, busy, onSave }: {
  binding?: SetupWeightBinding; current: boolean; authorized: boolean; busy: boolean;
  onSave: (policy: SetupWeightPolicy) => Promise<void>;
}) {
  const [policy, setPolicy] = useState<SetupWeightPolicy | null>(() => binding ? structuredClone(binding.policy) : null);
  if (!binding || !policy) return <section className="setup-weight-tuner"><h3>Source & model weights</h3><p>Weight policy unavailable for this revision.</p></section>;
  const valid = validPolicyTotals(policy);
  const dirty = !samePolicy(policy, binding.policy);
  return <details className="setup-weight-tuner">
    <summary><span>Source & model weights</span><small>{binding.policy.policy_id} · advisory only</small></summary>
    <p>Controls relative influence in generated analysis. Official authority, raw values, warnings, and approval gates cannot be down-weighted.</p>
    <WeightGroup title="Evidence inputs" keys={EVIDENCE_WEIGHT_SOURCES} weights={policy.evidence_weights}
      onChange={(key, percent) => setPolicy(value => value ? { ...value, evidence_weights: setWeight(value.evidence_weights, key, percent) } : value)} />
    <WeightGroup title="Review models" keys={REVIEW_WEIGHT_SOURCES} weights={policy.review_weights}
      onChange={(key, percent) => setPolicy(value => value ? { ...value, review_weights: setWeight(value.review_weights, key, percent) } : value)} />
    {!valid && <p className="setup-weight-tuner__warning" role="status">Each group must total exactly 100% before saving.</p>}
    <div className="setup-weight-tuner__actions"><button type="button" disabled={!dirty || !valid || !current || !authorized || busy}
      onClick={() => void onSave(policy)}>Save weights for this revision</button>
      <button type="button" disabled={!dirty || busy} onClick={() => setPolicy(structuredClone(binding.policy))}>Undo edits</button></div>
    {!current ? <p>Historical revision weights are read only.</p> : !authorized ? <p>OWNER or ADMIN access is required to tune weights.</p> : null}
    {binding.policy_digest && <small>Policy {binding.policy_digest.slice(0, 12)} · changing it requires fresh advisory reviews and approval.</small>}
  </details>;
}
