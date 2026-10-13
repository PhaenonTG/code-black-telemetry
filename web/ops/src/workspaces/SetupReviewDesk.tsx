import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { fetchForecast, postSetupWorkflow } from "../core/client";
import type { OpsCoreConfig } from "../core/config";
import { canApprove, reviewStatus, type SetupWorkflow } from "./setupReviewModel";

export function SetupReviewDesk({ config, setupId, revision, fingerprint, current, initial }: {
  config: OpsCoreConfig; setupId: string; revision: number; fingerprint?: string; current: boolean; initial?: SetupWorkflow;
}) {
  const auth = useAuth();
  const role = auth.status === "authorized" ? auth.profile.role : undefined;
  const [workflow, setWorkflow] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const decisionRole = ["OWNER", "ADMIN"].includes(role ?? "");

  useEffect(() => {
    if (workflow?.status !== "pending") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await fetchForecast<{ workflow: SetupWorkflow; current_revision: number }>(config,
        `chase-setup?setup_id=${setupId}&revision=${revision}`, controller.signal).then(record => {
          if (!controller.signal.aborted) {
            setWorkflow(record.workflow);
            if (record.current_revision !== revision) setError("A newer revision is available. Refresh before making a decision.");
          }
        }).catch(() => { if (!controller.signal.aborted) setError("Review status could not be refreshed. Use Refresh to check again."); });
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000);
    };
    timer = setTimeout(() => void poll(), 5000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [config, setupId, revision, workflow?.status]);

  async function submit(decision?: "approved" | "changes_requested") {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await postSetupWorkflow<SetupWorkflow>(config,
        decision ? "chase-setup-decision" : "chase-setup-review", {
          setup_id: setupId, revision, source_fingerprint: fingerprint,
          ...(decision ? { decision, note, packet_digest: workflow?.packet_digest } : {}),
        });
      setWorkflow(result);
      if (decision) { setMessage(`Decision saved for revision ${revision}.`); setNote(""); setAcknowledged(false); }
    } catch (err) { setError(err instanceof Error ? err.message : "Action unavailable. Refresh to check its status."); }
    finally { setBusy(false); }
  }

  return <section className="setup-review-desk" aria-label="Revision advisory reviews and decision">
    <div className="chase-setups__section-head"><h3>Advisory reviews <small>REVISION {revision}</small></h3>
      <span>{reviewStatus(workflow?.status)}</span></div>
    <p>Independent interpretations of this revision’s SPC outlook and HRRR screening. Neither reviewer confirms storms or changes the evidence.</p>
    <button type="button" className="setup-review-desk__run" onClick={() => void submit()}
      disabled={!current || !fingerprint || !role || busy || workflow?.status === "pending" || workflow?.status === "ready"}>
      {workflow?.status === "pending" ? "Review in progress…" : workflow?.status === "ready" ? "Reviews saved" : "Run advisory reviews"}</button>
    {workflow?.started_at && <p className="setup-review-desk__time">Started {new Date(workflow.started_at).toLocaleString()}
      {workflow.completed_at && ` · Completed ${new Date(workflow.completed_at).toLocaleString()}`}</p>}
    <div className="chase-setups__reviews">{[["aegis", "Aegis analysis"], ["local_30b", "Local 30B review"]].map(([key, title]) => {
      const review = workflow?.reviewers[key];
      return <div key={key}><h4>{title}</h4><small>{review?.model ?? (key === "aegis" ? "qwen3:8b" : "qwen3-coder:30b")} · {reviewStatus(review?.status)}</small>
        {review?.status === "ready" ? <><p>{review.summary}</p>
          {review.primary_hazards && review.primary_hazards.length > 0 && <p><strong>Hazards assessed:</strong> {review.primary_hazards.join(", ")}</p>}
          <details><summary>Storm mode and initiation</summary><p>{review.storm_mode}</p><p>{review.initiation}</p></details>
          {[["Supporting evidence", review.supporting_factors], ["Limits", review.limiting_factors], ["Uncertainty", review.uncertainties],
            ["Watch next", review.attention], ["Missing information", review.missing_information]].map(([label, items]) =>
            Array.isArray(items) && items.length > 0 ? <details key={String(label)}><summary>{String(label)} ({items.length})</summary><ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul></details> : null)}
        </> : <p>{review?.status === "pending" ? "Waiting for the sequential local review to finish."
          : review?.reason === "unsupported_risk_category" ? "Review withheld: its risk category conflicted with the official SPC outlook."
          : review?.reason === "interrupted" ? "This review was interrupted. Run the reviews again."
          : review?.reason ? "The reviewer could not return a validated assessment. Retry after a minute." : "Run reviews to assess this captured evidence."}</p>}</div>;
    })}</div>
    <div className="setup-review-desk__comparison"><strong>Review comparison</strong>
      <p>{workflow?.comparison?.status === "differences" ? `The reviewers differ in ${workflow.comparison.differences.map(field => field.replaceAll("_", " ")).join(" and ")}. Read both explanations before deciding.`
        : workflow?.comparison?.status === "aligned_categories" ? "Hazard categories and attention items align. Read both explanations; matching categories do not establish certainty."
        : "Both validated reviews are needed to compare their findings."}</p>
      <p>Not supplied: thermodynamic or wind profiles, surface observations, RAP, mesoscale discussions, watches, warnings, observed radar. The screening index cannot establish storm mode or specific hazards. Paid second opinion is disabled.</p></div>
    <div className="setup-review-desk__decision"><h3>Operator decision</h3>
      {workflow?.decision ? <div className="setup-review-desk__saved"><strong>{workflow.decision.decision === "approved" ? "Approved for this revision" : "Changes requested"}</strong>
        <p>{workflow.decision.note}</p><small>{workflow.decision.actor_role} · {new Date(workflow.decision.decided_at).toLocaleString()}</small></div> : <p>No operator decision saved for revision {revision}.</p>}
      {workflow?.decision_history && workflow.decision_history.length > 1 && <details><summary>Decision history ({workflow.decision_history.length} recent)</summary><ol>{workflow.decision_history.map(event => <li key={event.id}><strong>{event.decision.replaceAll("_", " ")}</strong> · {new Date(event.decided_at).toLocaleString()}<p>{event.note}</p></li>)}</ol></details>}
      {!current ? <p>Historical revisions are read only. Return to the current revision to review or decide.</p>
        : !decisionRole ? <p>OWNER or ADMIN access is required to save an operator decision.</p> : <>
          <label htmlFor="setup-review-note">Review note</label><textarea id="setup-review-note" value={note} maxLength={800} rows={3} onChange={event => setNote(event.target.value)} placeholder="Explain your decision and any evidence that still needs checking." />
          <label className="setup-review-desk__ack"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I have read the evidence, both advisory reviews, and their limitations for revision {revision}.</label>
          {(workflow?.approval_blockers ?? ["Advisory reviews are unavailable."]).map(blocker => <p className="setup-review-desk__blocker" key={blocker}>{blocker}</p>)}
          <div className="setup-review-desk__actions"><button type="button" disabled={busy || !note.trim() || !fingerprint} onClick={() => void submit("changes_requested")}>Request changes</button>
            <button type="button" disabled={busy || !note.trim() || !acknowledged || !canApprove(workflow, current, role)} onClick={() => void submit("approved")}>Approve revision {revision}</button></div>
        </>}
      <p className="setup-review-desk__boundary">Approval records a private operator decision. Public delivery is not connected. A changed revision requires fresh reviews and a new decision.</p>
    </div>
    {error && <p className="chase-setups__error" role="alert">{error}</p>}
    {message && <p className="setup-review-desk__success" role="status">{message}</p>}
  </section>;
}
