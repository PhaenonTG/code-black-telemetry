import { useCallback, useEffect, useState } from "react";
import { fetchForecast } from "../core/client";
import { useCoreOps } from "../core/useCoreOps";
import { SetupSynthesis } from "../workspaces/SetupSynthesis";
import type { WeightedSynthesis } from "../workspaces/setupReviewModel";
import AegisAlerts from "./AegisAlerts";
import "./ChaseSetups.css";

type SetupRow = { setup_id: string; day: number; risk_label: string; revision: number; valid_until: string };
type SetupIndex = { status: string; checked_at?: string; last_source_check_at?: string; items: SetupRow[] };
type SetupDetail = SetupRow & { weighted_synthesis?: WeightedSynthesis | null };

export default function ChaseSurveillance() {
  const { config } = useCoreOps();
  const [setups, setSetups] = useState<SetupDetail[]>([]);
  const [index, setIndex] = useState<SetupIndex | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError("");
    try {
      const next = await fetchForecast<SetupIndex>(config, "chase-setups", signal);
      const details = await Promise.all(next.items.map(row => fetchForecast<SetupDetail>(config, `chase-setup?setup_id=${encodeURIComponent(row.setup_id)}`, signal)));
      if (!signal?.aborted) { setIndex(next); setSetups(details); }
    } catch { if (!signal?.aborted) setError("Setup surveillance evidence is unavailable. Aegis remains separate and is not an all-clear."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [config]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return <div className="chase-surveillance">
    <section className="chase-surveillance__status"><header><div><h2>Chase surveillance</h2><p>Live operational evidence coverage across active setup corridors.</p></div><button type="button" onClick={() => void load()} disabled={busy}>{busy ? "Checking…" : "Refresh sources"}</button></header>
      {error && <p className="chase-setups__error" role="alert">{error}</p>}
      <div className="chase-surveillance__meta"><span data-ready={index?.status === "ready"}>SOURCE COLLECTOR · {(index?.status ?? "unavailable").replaceAll("_", " ")}</span><span>{setups.length} active setup{setups.length === 1 ? "" : "s"}</span><span>Checked {index?.last_source_check_at ? new Date(index.last_source_check_at).toLocaleString() : "unavailable"}</span></div>
      {setups.length ? <div className="chase-surveillance__setups">{setups.map(setup => <article key={setup.setup_id}><h3>SPC Day {setup.day} · {setup.risk_label}</h3><small>{setup.setup_id} · revision {setup.revision} · valid until {new Date(setup.valid_until).toLocaleString()}</small><SetupSynthesis synthesis={setup.weighted_synthesis} compact /></article>)}</div> : !busy && !error ? <p>No active setup corridor is currently retained.</p> : null}
      <p className="setup-synthesis__notice">Coverage and model support describe available inputs only. Official NWS warnings remain authoritative; absence here is never an all-clear.</p>
    </section>
    <AegisAlerts />
  </div>;
}
