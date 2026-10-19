import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchForecast } from "../core/client";
import { getAegisStatus, getAegisFeed, type AegisStatus, type AegisRadarAlert } from "../core/aegisFeed";
import { useCoreOps } from "../core/useCoreOps";
import { formatOpsTimestamp } from "../core/timeFormat";
import { OpsStatusPill } from "../components/OpsStatusPill";
import { EmptyState, ErrorState } from "../components/AsyncViewState";
import { SetupReviewTitle } from "../workspaces/chaseDay/setupReview/SetupReviewTitle";
import { SetupSynthesis } from "../workspaces/SetupSynthesis";
import { surveillanceDetails, type SetupIndex, type SetupDetail } from "../workspaces/chaseDay/setupReview/SetupSurveillanceRead";
import "./ChaseSetups.css";

function when(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? <time dateTime={value} title={new Date(value).toISOString()}>{formatOpsTimestamp(value)}</time> : "\u2014";
}
export default function ChaseSurveillance() {
  const { config } = useCoreOps();
  const [setups, setSetups] = useState<SetupDetail[]>([]);
  const [index, setIndex] = useState<SetupIndex | null>(null);
  const [aegis, setAegis] = useState<AegisStatus | null>(null);
  const [warnings, setWarnings] = useState<AegisRadarAlert[]>([]);
  const [aegisError, setAegisError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const signal = controller.signal;
    setBusy(true); setError("");
    const [setupResult, statusResult, feedResult] = await Promise.allSettled([
      (async () => {
        const next = await fetchForecast<SetupIndex>(config, "chase-setups", signal);
        return { next, details: await surveillanceDetails(config, next.items, signal) };
      })(), getAegisStatus(config, signal), getAegisFeed(config, signal),
    ]);
    if (signal.aborted) return;
    if (setupResult.status === "fulfilled") { setIndex(setupResult.value.next); setSetups(setupResult.value.details); }
    else setError("Setup surveillance evidence is unavailable. Absence here is never an all-clear.");
    if (statusResult.status === "fulfilled") setAegis(statusResult.value);
    if (feedResult.status === "fulfilled") setWarnings(feedResult.value.items);
    setAegisError(statusResult.status === "rejected" || feedResult.status === "rejected" ? "Alert feed unavailable. This is not an all-clear." : "");
    setBusy(false);
  }, [config]);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);
  return <div className="chase-surveillance">
    <SetupReviewTitle title="Surveillance" description="Official warnings first · Aegis findings are internal · absence here is never an all-clear."
      state={error ? "Unavailable" : index ? index.status === "ready" ? "Live" : "Stale" : "Waiting"}
      checkedAt={index?.last_source_check_at ?? index?.checked_at} busy={busy} refresh={() => void load()} reloads="surveillance evidence and the Aegis summary" />
    {error && <ErrorState title="Surveillance evidence unavailable" message={error} onRetry={() => void load()} />}
    <section className="chase-surveillance__status" aria-label="Official warnings">
      <h2>Official warnings</h2>
      {warnings.length ? <ul>{Array.from(new Map(warnings.map(item => [item.official_warning.headline, item])).values()).map(item => <li key={item.id}><a href={item.official_warning.source_url} target="_blank" rel="noreferrer">{item.official_warning.headline} ↗</a></li>)}</ul>
        : <p>{aegisError ? "Official warning evidence unavailable." : "No official warnings retained in the Aegis feed. Check official NWS guidance; this is never an all-clear."}</p>}
    </section>
    <section className="chase-surveillance__status" aria-label="Active setup corridors"><h2>Active setup corridors ({setups.length})</h2>
      {setups.length ? <div className="chase-surveillance__setups">{setups.map(setup => <article key={setup.setup_id}><h3>SPC Day {setup.day} · {setup.risk_label}</h3><small>{setup.setup_id} · revision {setup.revision} · valid until {when(setup.valid_until)}</small>
        {setup.unavailable ? <><OpsStatusPill state="Unavailable" /><p>Setup evidence unavailable.</p></> : <SetupSynthesis synthesis={setup.weighted_synthesis} compact />}</article>)}</div>
        : !busy && !error ? <EmptyState title="No active setup corridors" message="No corridor is currently retained. Official warnings remain authoritative." /> : null}
      <p className="setup-synthesis__notice">Coverage and model support describe available inputs only. Official NWS warnings remain authoritative; absence here is never an all-clear.</p>
    </section>
    {aegisError && <ErrorState title="Alert feed unavailable. This is not an all-clear." onRetry={() => void load()} />}
    <p className="analysis-aegis-summary">Aegis: {(aegis?.screen.qualified_alerts === undefined) && <OpsStatusPill state="Unavailable" />} {aegis ? `${aegis.screen.qualified_alerts ?? "\u2014"} qualifying alerts` : "\u2014"} · {aegis ? aegis.delivery_enabled ? "live delivery" : "shadow mode" : "delivery state unavailable"} · last screen {when(aegis?.screen.checked_at)} · <Link to="/aegis-alerts">Open Aegis Alerts →</Link></p>
  </div>;
}
