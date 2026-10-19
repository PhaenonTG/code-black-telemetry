import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_DRAFT, type PolicyDraft } from "../automation/policyLab";
import { PageHeader } from "../components/PageHeader";
import { getAegisPolicy, getAegisStatus, replayAegisPolicy, type AegisPolicyStatus,
  type AegisRecordedReplay, type AegisScenarioReplay, type AegisStatus } from "../core/aegisFeed";
import { useCoreOps } from "../core/useCoreOps";
import "../styles/automation-lab.css";

const PRESETS: Array<{ label: string; draft: Partial<PolicyDraft> }> = [
  { label: "No candidate", draft: { candidateAvailable: false, deliveryEnabled: true } },
  { label: "Below cutoff", draft: { candidateAvailable: true, evidenceScore: 75, deliveryEnabled: true } },
  { label: "Qualifying / shadow", draft: { candidateAvailable: true, evidenceScore: 92, deliveryEnabled: false } },
  { label: "Qualifying / route", draft: { candidateAvailable: true, evidenceScore: 92, deliveryEnabled: true } },
];

export default function AutomationLab() {
  const { config } = useCoreOps();
  const [live, setLive] = useState<AegisStatus | null>(null);
  const [liveError, setLiveError] = useState(false);
  const [policy, setPolicy] = useState<AegisPolicyStatus | null>(null);
  const [draft, setDraft] = useState<PolicyDraft>(DEFAULT_DRAFT);
  const [result, setResult] = useState<AegisScenarioReplay | null>(null);
  const [recorded, setRecorded] = useState<AegisRecordedReplay | null>(null);
  const [running, setRunning] = useState(false);
  const [replayError, setReplayError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const [next, nextPolicy] = await Promise.all([
          getAegisStatus(config, controller.signal), getAegisPolicy(config, controller.signal),
        ]);
        if (!controller.signal.aborted) { setLive(next); setPolicy(nextPolicy); setLiveError(false); }
      } catch {
        if (!controller.signal.aborted) { setLive(null); setPolicy(null); setLiveError(true); }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [config]);

  const change = <K extends keyof PolicyDraft>(key: K, value: PolicyDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setResult(null);
  };
  const preset = (values: Partial<PolicyDraft>) => {
    setDraft({ ...DEFAULT_DRAFT, ...values });
    setResult(null);
  };
  const replay = async (mode: "scenario" | "recorded") => {
    setRunning(true); setReplayError("");
    try {
      if (mode === "scenario") {
        const next = await replayAegisPolicy<AegisScenarioReplay>(config, { mode, scenario: draft });
        if (next.mode !== "scenario") throw new Error("Unexpected Core replay mode");
        setResult(next);
      } else {
        const next = await replayAegisPolicy<AegisRecordedReplay>(config,
          { mode, evidenceCutoff: draft.evidenceCutoff, limit: 10 });
        if (next.mode !== "recorded") throw new Error("Unexpected Core replay mode");
        setRecorded(next);
      }
    } catch (error) { setReplayError(error instanceof Error ? error.message : "Core replay failed"); }
    finally { setRunning(false); }
  };

  return <div className="page automation-lab">
    <PageHeader kicker="OPS / WORKFLOW DESIGN" title="Automation Lab"
      description="Rehearse Aegis policy on Core without publishing alerts or changing live settings. Activation remains locked while radar scoring is validated." />

    <section className="automation-lab__live" aria-label="Current Core state">
      <div><small>CORE SCREEN</small><b>{liveError ? "UNAVAILABLE" : !live ? "CHECKING" : live.screen.enabled ? "RUNNING" : "OFF"}</b></div>
      <div><small>REAL DELIVERY</small><b>{liveError ? "UNAVAILABLE" : !live ? "CHECKING" : live.delivery_enabled ? "ON" : "OFF / SHADOW"}</b></div>
      <div><small>REAL CUTOFF</small><b>{live?.screen.cutoff ?? "—"}</b></div>
      <div><small>RADAR SITES</small><b>{live?.screen.sites?.join(", ") || "—"}</b></div>
    </section>

    <section className="automation-lab__policy" aria-label="Core policy revision">
      <div><small>CORE POLICY JOURNAL</small><strong>{policy?.current_draft ? `Revision ${policy.current_draft.revision}` : "Unavailable"}</strong>
        <span>{policy?.current_draft ? `Draft cutoff ${policy.current_draft.evidence_cutoff} · ${policy.current_draft.action}` : "Core policy state could not be loaded"}</span></div>
      <div><small>ACTIVATION</small><strong>{policy?.activation_locked ? "LOCKED / SHADOW" : "UNKNOWN"}</strong>
        <span>Draft revisions never change the live scanner. Audit and rollback are Core-local operations.</span></div>
    </section>

    <div className="automation-lab__columns">
      <section className="automation-lab__panel" aria-label="Draft dispatch policy">
        <div className="automation-lab__panel-heading"><span>01 / POLICY DRAFT</span><strong>Build a scenario</strong></div>
        <p className="automation-lab__note">This tests downstream routing only. It does not manufacture radar evidence or predict a tornado.</p>
        <div className="automation-lab__presets" aria-label="Example scenarios">
          {PRESETS.map((item) => <button key={item.label} type="button" onClick={() => preset(item.draft)}>{item.label}</button>)}
        </div>
        <div className="automation-lab__fields">
          <label>Warning trigger
            <select value={draft.warning} onChange={(event) => change("warning", event.target.value as PolicyDraft["warning"])}>
              <option>Tornado Warning</option><option>Severe Thunderstorm Warning</option>
            </select>
          </label>
          <label className="automation-lab__check"><input type="checkbox" checked={draft.candidateAvailable}
            onChange={(event) => change("candidateAvailable", event.target.checked)} /> Persistent radar candidate supplied</label>
          <label>Candidate evidence score <b>{draft.evidenceScore}/100</b>
            <input type="range" min="0" max="100" value={draft.evidenceScore}
              onChange={(event) => change("evidenceScore", Number(event.target.value))} />
          </label>
          <label>Draft cutoff <b>{draft.evidenceCutoff}/100</b>
            <input type="range" min="70" max="100" value={draft.evidenceCutoff}
              onChange={(event) => change("evidenceCutoff", Number(event.target.value))} />
          </label>
          <label>Age of candidate scan, minutes
            <input type="number" min="0" max="60" value={draft.scanAgeMinutes}
              onChange={(event) => change("scanAgeMinutes", Number(event.target.value))} />
          </label>
          <label className="automation-lab__check"><input type="checkbox" checked={draft.deliveryEnabled}
            onChange={(event) => change("deliveryEnabled", event.target.checked)} /> Pretend delivery is enabled</label>
        </div>
        <button className="automation-lab__run" type="button" disabled={running} onClick={() => void replay("scenario")}>{running ? "Running on Core…" : "Run Core dry-run"}</button>
        <button className="automation-lab__secondary" type="button" disabled={running} onClick={() => void replay("recorded")}>Replay 10 recorded scans</button>
        {replayError && <p className="automation-lab__error" role="alert">{replayError}</p>}
        <p className="automation-lab__note">The live cutoff and delivery gate above never change when you run this test.</p>
      </section>

      <section className="automation-lab__panel" aria-label="Dry-run trace">
        <div className="automation-lab__panel-heading"><span>02 / EXECUTION TRACE</span><strong>{result ? result.decision.replaceAll("_", " ") : "Awaiting dry-run"}</strong></div>
        {result ? <>
          <p className="automation-lab__decision">{result.reason}</p>
          <ol className="automation-lab__trace">{result.trace.map((row) => <li key={row.step}>
            <b>{row.step}</b><span>{row.outcome}</span>
          </li>)}</ol>
          <div className="automation-lab__destinations">
            <span>FABRIC <b>{result.fabric ? "WOULD SEND" : "NO SEND"}</b></span>
            <span>OPS <b>{result.ops ? "WOULD SHOW" : "NO ALERT"}</b></span>
            <span>DISCORD <b>{result.discord ? "WOULD POST" : "NO POST"}</b></span>
          </div>
        </> : <p className="automation-lab__empty">Choose a preset or adjust the draft, then run a dry-run to see each gate and downstream destination.</p>}
        <p className="automation-lab__note">Official NWS warnings stay on their existing independent Discord route. Aegis candidates remain supplemental and unconfirmed.</p>
        <Link className="automation-lab__feed-link" to="/aegis-alerts">Open live Aegis feed and evidence map →</Link>
      </section>
    </div>
    <section className="automation-lab__recorded automation-lab__panel" aria-label="Recorded radar replay">
      <div className="automation-lab__panel-heading"><span>03 / RECORDED EVIDENCE</span><strong>{recorded ? `${recorded.scans_reviewed} scans · ${recorded.candidates_reviewed} candidates` : "Awaiting replay"}</strong></div>
      <p className="automation-lab__note">{recorded?.limitation || "Replay checks saved radar screening evidence against the selected draft cutoff. No messages are sent."}</p>
      {recorded?.scans.map((scan) => <div className="automation-lab__scan" key={`${scan.site}:${scan.volume_key}`}>
        <b>{scan.site} · {scan.scan_time}</b><span>{scan.candidates.length} captured candidate{scan.candidates.length === 1 ? "" : "s"}</span>
        {scan.candidates.map((candidate, index) => <span key={`${candidate.warning_id}:${index}`}>
          {candidate.decision.replaceAll("_", " ")} · score {candidate.evidence_score ?? "unavailable"}
        </span>)}
      </div>)}
    </section>
  </div>;
}
