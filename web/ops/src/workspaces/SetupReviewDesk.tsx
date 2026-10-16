import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { fetchForecast, postSetupWorkflow } from "../core/client";
import type { OpsCoreConfig } from "../core/config";
import { SetupWeightTuner } from "./SetupWeightTuner";
import { approvalDisabledReason, reviewStatus, type SetupWeightPolicy, type SetupWorkflow } from "./setupReviewModel";

export function SetupReviewDesk({ config, setupId, revision, fingerprint, current, initial, onWorkflowChange }: {
  config: OpsCoreConfig; setupId: string; revision: number; fingerprint?: string; current: boolean; initial?: SetupWorkflow;
  onWorkflowChange?: (workflow: SetupWorkflow) => void;
}) {
  const auth = useAuth();
  const role = auth.status === "authorized" ? auth.profile.role : undefined;
  const [workflow, setWorkflow] = useState(initial);
  const [busyAction, setBusyAction] = useState<"review" | "decision" | "paid" | "weights" | null>(null);
  const busy = busyAction !== null;
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const decisionRole = ["OWNER", "ADMIN"].includes(role ?? "");
  const approvalReason = approvalDisabledReason(workflow, { current, role, note, acknowledged, fingerprint });

  useEffect(() => {
    if (!current && workflow?.status !== "pending") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await fetchForecast<{ workflow: SetupWorkflow; current_revision: number }>(config,
        `chase-setup?setup_id=${setupId}&revision=${revision}`, controller.signal).then(record => {
          if (!controller.signal.aborted) {
            setWorkflow(record.workflow);
            onWorkflowChange?.(record.workflow);
            if (record.current_revision !== revision) setError("A newer revision is available. Refresh before making a decision.");
          }
        }).catch(() => { if (!controller.signal.aborted) setError("Review status could not be refreshed. Use Refresh to check again."); });
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), workflow?.status === "pending" ? 5000 : 30000);
    };
    timer = setTimeout(() => void poll(), workflow?.status === "pending" ? 5000 : 30000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [config, current, onWorkflowChange, setupId, revision, workflow?.status]);

  async function submit(decision?: "approved" | "changes_requested") {
    if (busy) return;
    setBusyAction(decision ? "decision" : "review"); setError(""); setMessage("");
    try {
      const result = await postSetupWorkflow<SetupWorkflow>(config,
        decision ? "chase-setup-decision" : "chase-setup-review", {
          setup_id: setupId, revision, source_fingerprint: fingerprint,
          ...(decision ? { decision, note, packet_digest: workflow?.packet_digest } : {}),
        });
      setWorkflow(result);
      onWorkflowChange?.(result);
      if (decision) { setMessage(decision === "approved" ? `Posted revision ${revision} to Reviewed Briefings.` : `Changes requested for revision ${revision}.`); setNote(""); setAcknowledged(false); }
    } catch (err) { setError(err instanceof Error ? err.message : "Action unavailable. Refresh to check its status."); }
    finally { setBusyAction(null); }
  }
  async function requestPaidReview() {
    if (busy || !decisionRole || !fingerprint || workflow?.decision?.decision !== "approved") return;
    setBusyAction("paid"); setError(""); setMessage("");
    try {
      const result = await postSetupWorkflow<SetupWorkflow>(config, "chase-setup-paid-review", { setup_id: setupId, revision, source_fingerprint: fingerprint });
      setWorkflow(result);
      onWorkflowChange?.(result);
      setMessage("Full private review requested for this exact approved revision.");
    } catch (err) { setError(err instanceof Error ? err.message : "Paid review could not be confirmed."); }
    finally { setBusyAction(null); }
  }
  async function saveWeights(policy: SetupWeightPolicy) {
    if (busy || !decisionRole || !fingerprint || !current) return;
    setBusyAction("weights"); setError(""); setMessage("");
    try {
      const result = await postSetupWorkflow<SetupWorkflow>(config, "chase-setup-policy", {
        setup_id: setupId, revision, source_fingerprint: fingerprint, policy,
      });
      setWorkflow(result);
      onWorkflowChange?.(result);
      setMessage("Weights saved for this revision. Run fresh advisory reviews before approval.");
      setNote(""); setAcknowledged(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Weight policy could not be saved."); }
    finally { setBusyAction(null); }
  }

  return <section className="setup-review-desk" aria-label="Revision advisory reviews and decision">
    <ol className="setup-review-desk__steps" aria-label="Reviewed briefing posting steps">
      <li data-complete={workflow?.status === "ready"}>Run advisory reviews</li>
      <li data-complete={Boolean(note.trim() && acknowledged)}>Add note and acknowledge limits</li>
      <li data-complete={workflow?.decision?.decision === "approved"}>Post to Reviewed Briefings</li>
    </ol>
    <SetupWeightTuner key={workflow?.weight_policy?.policy_digest ?? "missing"} binding={workflow?.weight_policy}
      current={current} authorized={decisionRole} busy={busy} onSave={saveWeights} />
    <div className="chase-setups__section-head"><h3>Advisory reviews <small>REVISION {revision}</small></h3>
      <span>{reviewStatus(workflow?.status)}</span></div>
    <p>Independent interpretations of this revision’s SPC outlook and HRRR screening. Neither reviewer confirms storms or changes the evidence.</p>
    <button type="button" className="setup-review-desk__run" onClick={() => void submit()}
      disabled={!current || !fingerprint || !role || busy || workflow?.status === "pending" || workflow?.status === "ready"}>
      {workflow?.status === "pending" ? "Review in progress…" : busyAction === "review" ? "Starting reviews…" : workflow?.status === "ready" ? "Reviews saved" : workflow?.status === "not_requested" || !workflow ? "Run required advisory reviews" : "Retry advisory reviews"}</button>
    {workflow?.started_at && <p className="setup-review-desk__time">Started {new Date(workflow.started_at).toLocaleString()}
      {workflow.completed_at && ` · Completed ${new Date(workflow.completed_at).toLocaleString()}`}</p>}
    <div className="chase-setups__reviews">{[["aegis", "Aegis analysis"], ["local_30b", "Local 30B review"]].map(([key, title]) => {
      const review = workflow?.reviewers[key];
      return <div key={key}><h4>{title}</h4><small>{review?.model ?? (key === "aegis" ? "qwen3:8b" : "qwen3-coder:30b")} · {reviewStatus(review?.status)}{review?.automatic ? " · Automatic" : ""}</small>
        {review?.status === "ready" ? <><p>{review.summary}</p>
          {review.primary_hazards && review.primary_hazards.length > 0 && <p><strong>Hazards assessed:</strong> {review.primary_hazards.join(", ")}</p>}
          <details><summary>Storm mode and initiation</summary><p>{review.storm_mode}</p><p>{review.initiation}</p></details>
          {[["Supporting evidence", review.supporting_factors], ["Limits", review.limiting_factors], ["Uncertainty", review.uncertainties],
            ["Watch next", review.attention], ["Missing information", review.missing_information]].map(([label, items]) =>
            Array.isArray(items) && items.length > 0 ? <details key={String(label)}><summary>{String(label)} ({items.length})</summary><ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul></details> : null)}
        </> : <p>{review?.status === "pending" ? "Waiting for the sequential local review to finish."
          : review?.reason === "unsupported_risk_category" ? "Review withheld: its risk category conflicted with the official SPC outlook."
          : review?.reason === "unsupported_absence_claim" ? "Review withheld: missing storm or warning inputs were treated as an all-clear."
          : review?.reason === "interrupted" ? "This review was interrupted. Run the reviews again."
          : review?.reason ? "The reviewer could not return a validated assessment. Retry after a minute." : "Run reviews to assess this captured evidence."}</p>}</div>;
    })}</div>
    <div className="setup-review-desk__comparison"><strong>Review comparison</strong>
      <p>{workflow?.comparison?.status === "differences" ? `The reviewers differ in ${workflow.comparison.differences.map(field => field.replaceAll("_", " ")).join(" and ")}. Read both explanations before deciding.`
        : workflow?.comparison?.status === "aligned_categories" ? "Hazard categories and attention items align. Read both explanations; matching categories do not establish certainty."
        : "Both validated reviews are needed to compare their findings."}</p>
      <p>{workflow?.missing_evidence?.length ? `Not supplied: ${workflow.missing_evidence.map(value => value.replaceAll("_", " ")).join(", ")}. ` : "All tracked packet source classes were supplied. "}The screening index cannot establish storm mode or specific hazards. The independent full review below remains private.</p>
      {workflow?.review_synthesis && <div className="setup-review-desk__review-weights"><strong>Available review influence</strong>{workflow.review_synthesis.contributions.map(row => <span key={row.source} data-ready={row.available}>{row.source.replaceAll("_", " ")} · {row.available ? `${(row.available_influence_bp / 10).toFixed(1)}%` : "pending"}</span>)}<small>Coverage {(workflow.review_synthesis.coverage_bp / 10).toFixed(1)}% · advisory influence, not confidence</small></div>}
    </div>
    <div className="setup-review-desk__decision"><h3>Post to Reviewed Briefings</h3>
      {workflow?.decision ? <div className="setup-review-desk__saved"><strong>{workflow.decision.decision === "approved" ? "Approved for this revision" : "Changes requested"}</strong>
        <p>{workflow.decision.note}</p><small>{workflow.decision.actor_role} · {new Date(workflow.decision.decided_at).toLocaleString()}</small>
        {workflow.decision.decision === "approved" && <p>Automation armed: this revision is in Reviewed Briefings and is eligible for the hourly private review while its evidence and weight policy remain current.</p>}</div> : <p>No operator decision saved for revision {revision}.</p>}
      {workflow?.decision_history && workflow.decision_history.length > 1 && <details><summary>Decision history ({workflow.decision_history.length} recent)</summary><ol>{workflow.decision_history.map(event => <li key={event.id}><strong>{event.decision.replaceAll("_", " ")}</strong> · {new Date(event.decided_at).toLocaleString()}<p>{event.note}</p></li>)}</ol></details>}
      {!current ? <p>Historical revisions are read only. Return to the current revision to review or decide.</p>
        : !decisionRole ? <p>OWNER or ADMIN access is required to save an operator decision.</p> : <>
          <label htmlFor="setup-review-note">Review note</label><textarea id="setup-review-note" value={note} maxLength={800} rows={3} onChange={event => setNote(event.target.value)} placeholder="Explain your decision and any evidence that still needs checking." />
          <label className="setup-review-desk__ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I have read the evidence, both advisory reviews, and their limitations for revision {revision}.</label>
          {(workflow?.approval_blockers ?? ["Advisory reviews are unavailable."]).map(blocker => <p className="setup-review-desk__blocker" key={blocker}>{blocker}</p>)}
          <div className="setup-review-desk__actions"><button type="button" disabled={busy || !note.trim() || !fingerprint} onClick={() => void submit("changes_requested")}>Request changes</button>
            <button type="button" disabled={busy || approvalReason !== null} title={approvalReason ?? undefined} onClick={() => void submit("approved")}>Post revision {revision} to Reviewed Briefings</button></div>
          {approvalReason && <p className="setup-review-desk__next" role="status">Next: {approvalReason}</p>}
        </>}
      <p className="setup-review-desk__boundary">Posting moves this exact revision to the private Reviewed Briefings tab. It does not publish publicly or send a message. A changed revision requires fresh reviews and a new decision.</p>
    </div>
    <div className="setup-review-desk__decision" aria-label="Hourly paid second opinion">
      <h3>Hourly independent review</h3>
      {decisionRole && current && <button type="button" className="setup-review-desk__run" disabled={busy || workflow?.decision?.decision !== "approved" || !fingerprint} onClick={() => void requestPaidReview()}>
        {busyAction === "paid" ? "Requesting full review…" : "Run full review now"}</button>}
      {workflow?.paid_review?.status === "ready" ? <div className="setup-review-desk__saved">
        <strong>{workflow.paid_review.verdict === "ready" ? "Evidence-bounded second opinion" : "Second opinion withheld"}</strong>
        <p>{workflow.paid_review.summary}</p>
        <small>{workflow.paid_review.model} · {workflow.paid_review.confidence ?? "confidence unavailable"} · {workflow.paid_review.reviewed_at ? new Date(workflow.paid_review.reviewed_at).toLocaleString() : "time unavailable"}</small>
        {workflow.paid_review.uncertainties && workflow.paid_review.uncertainties.length > 0 && <details><summary>Uncertainties ({workflow.paid_review.uncertainties.length})</summary><ul>{workflow.paid_review.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        {workflow.paid_review.next_hour_triggers && workflow.paid_review.next_hour_triggers.length > 0 && <details><summary>Check next hour ({workflow.paid_review.next_hour_triggers.length})</summary><ul>{workflow.paid_review.next_hour_triggers.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      </div> : <p>Available hourly or on owner/admin request only after approval of this exact current revision. It stays private and does not publish a briefing.</p>}
    </div>
    {error && <p className="chase-setups__error" role="alert">{error}</p>}
    {message && <p className="setup-review-desk__success" role="status">{message}</p>}
  </section>;
}
