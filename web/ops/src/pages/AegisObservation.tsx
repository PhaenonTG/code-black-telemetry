import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PageHeader } from "../components/PageHeader"
import { useCoreOps } from "../core/useCoreOps"
import { loadAegisObservationPlan, type AegisObservationPlan } from "../aegisObservation"

function when(value: string | null | undefined): string {
  if (!value) return "UNAVAILABLE"
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().replace(".000", "") : value
}

export default function AegisObservation() {
  const { config } = useCoreOps()
  const [plan, setPlan] = useState<AegisObservationPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refresh = async () => {
    setLoading(true); setError(null)
    try { setPlan(await loadAegisObservationPlan(config)) }
    catch { setError("Core has not confirmed an AEGIS observation plan. Existing radar and official alert operations are unchanged.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [config])
  const products = Object.entries(plan?.radar.products ?? {})
  const official = plan?.radar.official_storm_objects
  const stormTracks = official?.storm_tracking ?? []
  const mesocyclones = official?.mesocyclones ?? []
  return <div className="page page-aegis-observation">
    <PageHeader kicker="AEGIS" title="OBSERVATION PLAN" description="Evidence-first planning for live chaser radar coverage, approaching setup drafts, and future verification review. A plan never routes a vehicle, declares a tornado, or replaces official warnings." actions={<><button className="page-action-link" onClick={() => void refresh()} disabled={loading}>{loading ? "REFRESHING…" : "REFRESH"}</button><Link className="page-action-link" to="/targets">CHASE TARGETS</Link></>} />
    {error && <p className="aegis-error" role="alert">{error}</p>}
    {plan && <>
      <section className="aegis-hero"><div><span>EXECUTOR</span><strong>{plan.executor.state.replaceAll("_", " ")}</strong><p>{plan.executor.notice}</p></div><div><span>PLAN STATE</span><strong data-state={plan.state}>{plan.state.replaceAll("_", " ")}</strong><p>Generated {when(plan.generated_at)}</p></div></section>
      <section className="aegis-grid">
        <article><header><span>LIVE CHASER GATE</span><b>{plan.gates.fresh_chaser_location ?? "UNKNOWN"}</b></header>{plan.live_chasers.length ? <ul>{plan.live_chasers.map((chaser) => <li key={chaser.unit_id}><strong>{chaser.display_name ?? chaser.unit_id}</strong><span>{chaser.role} · every {chaser.cadence_minutes} min · seen {when(chaser.last_seen)}</span></li>)}</ul> : <p>No fresh explicit Fabric location is eligible. AEGIS will not claim closest-radar coverage until this gate is satisfied.</p>}</article>
        <article><header><span>RADAR EVIDENCE GATE</span><b>{plan.gates.trustworthy_radar_frames ?? "UNKNOWN"}</b></header><dl>{products.map(([name, product]) => <div key={name}><dt>{name}</dt><dd>{product.available ? `${product.trustworthy ? "TRUSTED" : "UNTRUSTED"} · ${product.freshness_state ?? "UNKNOWN"}` : "UNAVAILABLE"}</dd></div>)}</dl>{plan.radar.dominant_cell && <p>Dominant cell: {plan.radar.dominant_cell.max_dbz ?? "?"} dBZ · {plan.radar.dominant_cell.direction_degrees ?? "?"}° / {plan.radar.dominant_cell.speed_knots ?? "?"} kt · {plan.radar.dominant_cell.confidence ?? "UNKNOWN"} confidence.</p>}</article>
      </section>
      <section className="aegis-objects" aria-label="Official NWS storm objects">
        <header><div><span>OFFICIAL NWS STORM OBJECTS</span><h2>NST TRACKS + NMD MESOCYCLONES</h2></div><b data-state={official?.state}>{official?.state ?? "UNAVAILABLE"}</b></header>
        {!official || official.state !== "available" ? <p>{official?.notice ?? "Core has not supplied official NWS storm-object evidence yet. Existing radar evidence remains available."}</p> : <>
          <dl><div><dt>OBJECTS</dt><dd>{official.object_count ?? 0}</dd></div><div><dt>RETRIEVED</dt><dd>{when(official.retrieved_at)}</dd></div><div><dt>NST</dt><dd>{official.sources?.NST?.status ?? "UNKNOWN"}</dd></div><div><dt>NMD</dt><dd>{official.sources?.NMD?.status ?? "UNKNOWN"}</dd></div></dl>
          {official.object_count === 0 ? <p>{official.notice}</p> : <div className="aegis-objects__rows">
            {stormTracks.map((storm) => <div key={`storm-${storm.id}`}><strong>TRACK {storm.id ?? "UNKNOWN"}</strong><span>{storm.movement ? `${storm.movement.deg ?? "?"}° / ${storm.movement.kts ?? "?"} kt` : "MOTION NOT PUBLISHED"}</span><small>{storm.forecast?.length ? `Official positions: ${storm.forecast.map((point) => point.status ? `${point.leadMinutes ?? "?"}m ${point.status}` : `${point.leadMinutes ?? "?"}m`).join(" · ")}` : "No projected positions published."}</small></div>)}
            {mesocyclones.map((meso) => <div key={`meso-${meso.id}`}><strong>MESO {meso.id ?? "UNKNOWN"}{meso.tornadicVortexSignature ? " · TVS" : ""}</strong><span>{meso.motion && typeof meso.motion === "object" ? `${meso.motion.deg ?? "?"}° / ${meso.motion.kts ?? "?"} kt` : "MOTION NOT PUBLISHED"}</span><small>Storm {meso.stormId ?? "UNLINKED"}{meso.mesocycloneStrengthIndex != null ? ` · MSI ${meso.mesocycloneStrengthIndex}` : ""}</small></div>)}
          </div>}
        </>}
      </section>
      <section className="aegis-setups"><header><div><span>APPROACHING SETUP DRAFTS</span><h2>CADENCE TIGHTENS TOWARD VALID START</h2></div><b>{plan.setup_drafts.length} ACTIVE</b></header>{plan.setup_drafts.length ? <div className="aegis-setups__rows">{plan.setup_drafts.map((draft) => <div key={draft.setup_id}><strong>{draft.risk ?? "SPC SETUP"}</strong><span>{draft.setup_id} · valid {when(draft.valid_from)}</span><b>EVERY {draft.cadence_minutes} MIN</b><small>Radar: {draft.radar_context?.status ?? "UNAVAILABLE"} · Model: {draft.model_context?.status ?? "UNAVAILABLE"}</small></div>)}</div> : <p>No active private setup drafts are available. The draft generator will not invent a setup solely to schedule analysis.</p>}</section>
      <section className="aegis-grid"><article><header><span>MODEL DISCIPLINE</span><b>PROVENANCE REQUIRED</b></header><p>{plan.model_policy.current}</p><ul>{plan.model_policy.current_sources.map((source) => <li key={source}>{source}</li>)}</ul><p>{plan.model_policy.gap}</p></article><article><header><span>VERIFICATION + LEARNING</span><b>{plan.verification.state.replaceAll("_", " ")}</b></header><p>{plan.verification.rule}</p><p>{plan.verification.notice}</p></article><article><header><span>SATELLITE INGEST</span><b>{plan.satellite.state.replaceAll("_", " ")}</b></header><p>{plan.satellite.product ?? plan.satellite.target ?? "NOAA GOES ABI"}</p><p>{plan.satellite.satellite ? `${plan.satellite.satellite} · observed ${when(plan.satellite.observed_at)}` : plan.satellite.notice}</p><p>{plan.satellite.analysis_state ? `Analysis: ${plan.satellite.analysis_state.replaceAll("_", " ")}.` : null}</p><p>{plan.satellite.rule}</p></article></section>
    </>}
  </div>
}
