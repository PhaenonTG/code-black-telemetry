import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { AegisPanel, CellPanel, ChangesPanel, Empty, OfficialAlerts, Panel, UnitStrip } from "../desk/DeskPanels"
import { useDesk } from "../desk/DeskProvider"
import { useCoreOps } from "../core/useCoreOps"
import { ageLabel, localTime } from "../desk/format"
import { loadSetupDraft, type SetupDraft } from "../desk/setupSources"
import type { RadarFrame } from "../../../../src/services/radar"
const DeskMap = lazy(() => import("../desk/DeskMap").then((module) => ({ default: module.DeskMap })))

function SetupDesk() {
  const { setups, errors, now, observation, checkedAt, choosePoint } = useDesk()
  const { config, selectedPoint } = useCoreOps()
  const [chosen, setChosen] = useState("")
  const [detail, setDetail] = useState<{ key: string; draft: SetupDraft | null; error: string }>({ key: "", draft: null, error: "" })
  const items = (setups?.items ?? []).filter((item) => Date.parse(item.valid_until) > now)
  const selected = items.find((item) => item.setup_id === chosen) ?? items[0]
  const selectedId = selected?.setup_id
  const requestKey = `${selectedId ?? ""}-${selected?.revision ?? ""}`
  const draft = detail.key === requestKey ? detail.draft : null
  const draftError = detail.key === requestKey ? detail.error : ""
  useEffect(() => {
    if (!selectedId) return
    let disposed = false
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 12_000)
    void loadSetupDraft(config, selectedId, controller.signal).then((value) => { if (!disposed) setDetail({ key: requestKey, draft: value, error: "" }) }).catch(() => { if (!disposed) setDetail((current) => ({ key: requestKey, draft: current.key === requestKey ? current.draft : null, error: "Setup detail unavailable. Retry from source controls. Last received detail may be stale." })) }).finally(() => window.clearTimeout(timer))
    return () => { disposed = true; controller.abort(); window.clearTimeout(timer) }
  }, [selectedId, requestKey, config, checkedAt])
  const targets = [...(draft?.model.target_points ?? [])].sort((a, b) => b.score_index - a.score_index).slice(0, 6)
  const targetPoints = useMemo(() => (draft?.model.target_points ?? []).map((target) => ({ lat: target.latitude, lon: target.longitude })), [draft])
  const tracking = draft?.tornado_tracking_map
  return <div className="desk-analysis__grid"><div className="desk-analysis__targets"><Panel title="Setup areas" meta={setups?.status?.replaceAll("_", " ") ?? "Awaiting source"}>
    {!!errors.Setups && <p className="desk-source-warning">Setup source unavailable. Last received areas may be stale.</p>}
    {!errors.Setups && setups?.status === "source_degraded" && <p className="desk-source-warning">Setup inputs degraded. Last received areas may be stale.</p>}
    {!items.length && <Empty>No setup areas published. <Link to="/targets">Open point-based target planning →</Link></Empty>}
    <div className="desk-setup-selector">{items.map((item) => <button key={item.setup_id} onClick={() => setChosen(item.setup_id)} aria-pressed={selected?.setup_id === item.setup_id}><strong>{item.risk_label} · Day {item.day}</strong><small>{localTime(item.valid_from)}–{localTime(item.valid_until)} · {ageLabel(item.generated_at, now)}</small></button>)}</div>
    {draftError && <p className="desk-source-warning">{draftError}</p>}
    {draft && <div className="desk-panel__body"><span className="desk-eyebrow">{draft.review.required ? "Review required · Internal draft" : "Internal guidance"}</span><p>{draft.summary}</p>{targets.map((target, index) => <button className="desk-ranked-target" key={`${target.latitude}-${target.longitude}-${target.valid_time}`} onClick={() => choosePoint({ lat: target.latitude, lon: target.longitude }, { label: `Setup target ${index + 1}`, setupId: draft.setup_id, revision: draft.revision, validTime: target.valid_time, runTime: target.run_time })} aria-pressed={selectedPoint?.lat === target.latitude && selectedPoint?.lon === target.longitude}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{target.classification.replaceAll("_", " ")}</strong><small>{target.latitude.toFixed(3)}, {target.longitude.toFixed(3)} · {localTime(target.valid_time)}</small></span><span>{Number.isFinite(target.score_index) ? target.score_index.toFixed(1) : "—"}<small>Index</small></span></button>)}{!targets.length && <Empty>No model target points available.</Empty>}<small className="desk-muted">Ranking index, not a probability. {draft.model.notice}</small></div>}
  </Panel></div><div className="desk-analysis__map"><Suspense fallback={<Empty>Loading setup map…</Empty>}><DeskMap targetPoints={targetPoints} riskAreas={tracking?.features} bounds={draft?.bounds} /></Suspense>{tracking?.status === "available" && <div className="desk-tornado-map-note"><strong>Code Black tornado tracking</strong><span>Shaded boundaries: official SPC tornado outlook · Aegis: {tracking.aegis_status.replaceAll("_", " ")}</span><small>{tracking.numeric_point_samples} numeric model point samples · {tracking.matched_numeric_fields} matched model fields</small>{tracking.aegis_summary && <p>{tracking.aegis_summary}</p>}<small>Code Black has not assigned a separate tornado probability. {tracking.notice}</small></div>}</div><div className="desk-analysis__brief"><AegisPanel scope="point" /><ChangesPanel /></div><div className="desk-analysis__evidence"><Panel title="Evidence" meta="Source checks"><div className="desk-evidence-grid"><div><span>Model context</span><strong>{draft?.model.status?.replaceAll("_", " ") || "Unavailable"}</strong><small>{draft?.model.source || observation?.model_policy.current_sources?.join(" / ") || "No model source reported"}</small>{draft && <small>Compiled {ageLabel(draft.generated_at, now)}</small>}</div><div><span>Official outlook</span><strong>{draft?.official.risk_label || "No published area"}</strong>{draft?.official.source_url && <a href={draft.official.source_url} target="_blank" rel="noreferrer">SPC source ↗</a>}</div><div><span>Satellite</span><strong>{observation?.satellite.state?.replaceAll("_", " ") || "Unavailable"}</strong><small>{observation?.satellite.product || "No product reported"}</small></div></div><div className="desk-evidence-links"><Link to="/weather">Point numbers & surface obs →</Link><Link to="/targets">HRRR / RAP & target review →</Link><Link to="/aegis">Source gates →</Link></div></Panel></div></div>
}

function SurveillanceDesk() {
  const { observation, errors, now } = useDesk()
  const [frame, setFrame] = useState<RadarFrame | null>(null)
  const evidenceAge = observation?.radar.updated_at ? now - Date.parse(observation.radar.updated_at) : Infinity
  const freshEvidence = !errors.Observation && evidenceAge >= -60_000 && evidenceAge <= 18 * 60_000
  return <><UnitStrip /><div className="desk-surveillance__grid">
    <div className="desk-surveillance__map"><Suspense fallback={<Empty>Loading radar…</Empty>}><DeskMap radar onRadarFrame={setFrame} /></Suspense></div>
    <div className="desk-surveillance__alerts"><OfficialAlerts /><AegisPanel scope="point" /></div>
    <Panel title="Scan evidence" meta={errors.Observation ? "Source check failed" : observation?.radar.updated_at ? ageLabel(observation.radar.updated_at, now) : "Unavailable"} className="desk-surveillance__scans">
      <div className="desk-evidence-grid">{["REF", "VEL", "SRV", "CC"].map((product) => {
        const source = observation?.radar.products?.[product]
        return <div key={product}><span>{product}</span><strong>{source?.available ? !freshEvidence ? "Stale evidence" : source.trustworthy ? "Usable" : "Review needed" : "Unavailable"}</strong><small>{source?.freshness_state || "No scan evidence"}</small></div>
      })}</div>
      <div className="desk-panel__body"><p>{frame ? `${frame.site.id} · ${frame.product} frame metadata received. Tile coverage may be incomplete.` : "No single-site frame received. Select a site or check Radar Lab."}</p><small className="desk-muted">Rotation trends require verified scan pairs. No trend is inferred from a single image. Aegis uses Core's published radar evidence, which may differ from this view.</small><Link className="desk-inline-link" to="/targets">Target arming & full point review →</Link></div>
    </Panel>
    <div className="desk-surveillance__changes"><CellPanel /><ChangesPanel /></div>
  </div></>
}

export default function AnalysisDesk() {
  const { preferences, updatePreferences, refresh } = useDesk()
  const setup = preferences.analysisMode === "setup"
  return <div className="desk-workspace desk-analysis"><div className="desk-workspace-heading"><div><span className="desk-eyebrow">Internal intelligence</span><h1>Analysis</h1></div><div className="desk-mode-switch" role="group" aria-label="Analysis mode"><button aria-pressed={setup} onClick={() => updatePreferences({ analysisMode: "setup" })}>Setup</button><button aria-pressed={!setup} onClick={() => updatePreferences({ analysisMode: "surveillance" })}>Surveillance</button></div><button onClick={refresh}>Refresh sources</button></div>{setup ? <SetupDesk /> : <SurveillanceDesk />}
  </div>
}
