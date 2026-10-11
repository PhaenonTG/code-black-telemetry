import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_DRAFT, simulatePolicy, type PolicyDraft, type PolicyResult } from "../automation/policyLab";
import { PageHeader } from "../components/PageHeader";
import { getAegisStatus, type AegisStatus } from "../core/aegisFeed";
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
  const [draft, setDraft] = useState<PolicyDraft>(DEFAULT_DRAFT);
  const [result, setResult] = useState<PolicyResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const next = await getAegisStatus(config, controller.signal);
        if (!controller.signal.aborted) { setLive(next); setLiveError(false); }
      } catch {
        if (!controller.signal.aborted) { setLive(null); setLiveError(true); }
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

  return <div className="page automation-lab">
    <PageHeader kicker="OPS / WORKFLOW DESIGN" title="Automation Lab"
      description="Design and rehearse the Aegis warning-to-alert path. Every control here is a local draft; Run dry-run sends nothing and changes no live settings." />

    <section className="automation-lab__live" aria-label="Current Core state">
      <div><small>CORE SCREEN</small><b>{liveError ? "UNAVAILABLE" : live?.screen.enabled ? "RUNNING" : "CHECKING"}</b></div>
      <div><small>REAL DELIVERY</small><b>{live?.delivery_enabled ? "ON" : "OFF / SHADOW"}</b></div>
      <div><small>REAL CUTOFF</small><b>{live?.screen.cutoff ?? "—"}</b></div>
      <div><small>RADAR SITES</small><b>{live?.screen.sites?.join(", ") || "—"}</b></div>
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
        <button className="automation-lab__run" type="button" onClick={() => setResult(simulatePolicy(draft))}>Run dry-run</button>
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
  </div>;
}
