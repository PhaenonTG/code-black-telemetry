import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { AtlasMap, type AtlasSelectedPoint } from "../../../../src/map/AtlasMap"
import { PageHeader } from "../components/PageHeader"
import { StormIntelMetricBoard } from "../components/StormIntelMetricBoard"
import { useCoreOps } from "../core/useCoreOps"
import { assessmentSummary, localAiSummary } from "../localAiAdvisory"
import { useDesk } from "../desk/DeskProvider"
import { assessmentIsStale, reviewMatchesPoint, reviewPointKey } from "../desk/aegisReview"
import { firstAvailableSource, stormIntelSummary } from "../stormIntel/format"
import { loadWeatherAlertSettings, saveWeatherAlertSettings, type WeatherAlertSettings } from "../weatherAlertSettings"

function coords(point: { lat: number; lon: number } | null | undefined): string {
  return point ? `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}` : "NO POINT SELECTED"
}

function iso(value: string | null | undefined): string {
  if (!value) return "UNAVAILABLE"
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().replace(".000", "") : "UNAVAILABLE"
}

export default function ChaseTargets() {
  const { config, state, selectedPoint, selectPoint } = useCoreOps()
  const { ai, aegis, reviewSelection, choosePoint, refresh, now } = useDesk()
  const [settings, setSettings] = useState<WeatherAlertSettings | null>(null)
  const [label, setLabel] = useState("CHASE TARGET")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const snapshot = state.stormIntel.pointSnapshot
  const source = firstAvailableSource(snapshot)
  const activeTarget = settings?.target

  const savedReview = aegis.reviews[reviewPointKey(selectedPoint)]
  const targetAnalysis = reviewMatchesPoint(savedReview?.value, selectedPoint) ? savedReview.value : null
  const analyzingTarget = !!aegis.pending && aegis.pending !== "fleet"
  const refreshingAi = aegis.pending === "fleet"
  const reviewCooldown = now - (savedReview?.requestedAt ?? 0) < 30_000

  useEffect(() => {
    let cancelled = false
    void loadWeatherAlertSettings()
      .then((nextSettings) => {
        if (cancelled) return
        setSettings(nextSettings)
        if (!selectedPoint && nextSettings.target.lat != null && nextSettings.target.lon != null) {
          selectPoint({ lat: nextSettings.target.lat, lon: nextSettings.target.lon })
        }
      })
      .catch(() => { if (!cancelled) setError("Could not load chase-target controls from Core.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [config, selectedPoint, selectPoint])

  const armTarget = async () => {
    if (!settings || !selectedPoint) {
      setError("Choose a point on the map before arming a chase target.")
      return
    }
    setSaving(true); setError(null)
    try {
      const saved = await saveWeatherAlertSettings({
        ...settings,
        target: {
          ...settings.target,
          enabled: true,
          label: label.trim() || "CHASE TARGET",
          lat: selectedPoint.lat,
          lon: selectedPoint.lon,
        },
      })
      setSettings(saved)
      refresh()
    } catch {
      setError("Core did not confirm the target change. The prior target remains active.")
    } finally { setSaving(false) }
  }

  const disarmTarget = async () => {
    if (!settings) return
    setSaving(true); setError(null)
    try {
      const saved = await saveWeatherAlertSettings({
        ...settings,
        target: { ...settings.target, enabled: false, lat: null, lon: null },
      })
      setSettings(saved)
      refresh()
    } catch {
      setError("Core did not confirm the target change. The prior target remains active.")
    } finally { setSaving(false) }
  }

  const refreshAi = async () => {
    await aegis.run()
  }

  const analyzeTarget = async () => {
    if (!selectedPoint) { setError("Choose a point on the map before requesting radar analysis."); return }
    if (reviewSelection) await aegis.run(reviewSelection)
  }

  const radarTrack = targetAnalysis?.radar_evidence.dominant_cell_track
  const track = radarTrack && typeof radarTrack === "object" ? radarTrack as Record<string, unknown> : null
  const trackLocation = track?.location && typeof track.location === "object" ? track.location as { lat?: number; lon?: number } : null

  return (
    <div className="page page-targets">
      <PageHeader
        title="CHASE TARGETS"
        kicker="LIVE TARGET CONTROL"
        description="Select a point, review its current Storm Intel context, then arm it for warning-motion matching. Local AI remains advisory and reflects the configured Core vehicle context; official warning and radar information remain the operational source."
        actions={<Link className="page-action-link" to="/weather">WEATHER ANALYSIS</Link>}
      />
      {error && <p className="targets-error" role="alert">{error}</p>}
      {(savedReview?.error || aegis.fleetError) && <p className="targets-error" role="alert">{savedReview?.error || aegis.fleetError}</p>}
      <section className="targets-stage" aria-label="Chase target selection">
        <div className="targets-map">
          <AtlasMap gps={null} rangeRings="off" statusLines={[selectedPoint ? "TARGET POINT SELECTED" : "TAP MAP TO SET TARGET"]} controlsVariant="full" selectedPoint={selectedPoint} onPointSelect={(point: AtlasSelectedPoint) => choosePoint(point)} />
        </div>
        <aside className="targets-command">
          <header><span>ACTIVE TARGET</span><b>{activeTarget?.enabled ? "ARMED" : "DISARMED"}</b></header>
          <div className="targets-command__location">
            <strong>{activeTarget?.enabled ? activeTarget.label : "NO ACTIVE TARGET"}</strong>
            <span>{activeTarget?.enabled ? coords(activeTarget.lat != null && activeTarget.lon != null ? { lat: activeTarget.lat, lon: activeTarget.lon } : null) : "Choose a map point to begin."}</span>
          </div>
          <label className="targets-field"><span>TARGET LABEL</span><input value={label} maxLength={60} onChange={(event) => setLabel(event.target.value)} /></label>
          <dl className="targets-readout">
            <div><dt>Selected point</dt><dd>{coords(selectedPoint)}</dd></div>
            <div><dt>Environment</dt><dd>{stormIntelSummary(snapshot)}</dd></div>
            <div><dt>Model valid</dt><dd>{iso(source?.validTime)}</dd></div>
            <div><dt>Warning match</dt><dd>{activeTarget ? `${activeTarget.match_radius_miles} MI` : "UNAVAILABLE"}</dd></div>
          </dl>
          <button type="button" className="targets-action targets-action--analysis" onClick={() => void analyzeTarget()} disabled={!!aegis.pending || reviewCooldown || !selectedPoint || loading}>{analyzingTarget ? "ANALYZING RADAR…" : reviewCooldown ? "REVIEW COOLDOWN" : "RUN RADAR + AI ANALYSIS"}</button>
          <div className="targets-actions">
            <button type="button" className="targets-action targets-action--primary" onClick={() => void armTarget()} disabled={saving || !selectedPoint || loading}>{saving ? "SAVING…" : "ARM SELECTED TARGET"}</button>
            <button type="button" className="targets-action" onClick={() => void disarmTarget()} disabled={saving || !activeTarget?.enabled}>{saving ? "SAVING…" : "DISARM TARGET"}</button>
          </div>
          <p className="targets-note">Radar analysis is an advisory draft for this exact point. Arming updates the Core target used by the Discord warning-motion matcher; it does not create an automated route or claim a forecast probability.</p>
        </aside>
      </section>
      <section className="targets-radar-analysis" aria-label="Radar-informed target analysis">
        <header><div><span>RADAR-INFORMED TARGET ANALYSIS</span><h2>{targetAnalysis ? `${targetAnalysis.status.toUpperCase()}${assessmentIsStale(targetAnalysis, now) ? " · STALE" : ""}` : "NOT RUN"}</h2></div><b>{targetAnalysis ? iso(targetAnalysis.generated_at) : "SELECT A POINT"}</b></header>
        {targetAnalysis ? <>
          <p>{assessmentSummary(targetAnalysis)}</p>
          <dl>
            <div><dt>Radar source</dt><dd>{String(targetAnalysis.radar_evidence.status ?? "UNAVAILABLE")}</dd></div>
            <div><dt>Tracked cell</dt><dd>{String(track?.status ?? "UNAVAILABLE")}</dd></div>
            <div><dt>Cell location</dt><dd>{typeof trackLocation?.lat === "number" && Number.isFinite(trackLocation.lat) && typeof trackLocation.lon === "number" && Number.isFinite(trackLocation.lon) ? `${trackLocation.lat.toFixed(3)}, ${trackLocation.lon.toFixed(3)}` : "UNAVAILABLE"}</dd></div>
            <div><dt>Motion</dt><dd>{track?.direction_degrees != null && track?.speed_knots != null ? `${track.direction_degrees}° · ${track.speed_knots} KT` : "UNAVAILABLE"}</dd></div>
            <div><dt>Confidence</dt><dd>{String(track?.confidence ?? "UNAVAILABLE")}</dd></div>
            <div><dt>Radar valid</dt><dd>{iso(typeof track?.observed_at === "string" ? track.observed_at : null)}</dd></div>
          </dl>
          {targetAnalysis.status !== "available" && <p className="targets-error">{targetAnalysis.reason ?? "The guarded target analysis was unavailable."}</p>}
        </> : <p>Run analysis to create an advisory from the selected point’s Storm Intel plus the latest deterministic radar-worker track. It does not claim pixel-level visual interpretation.</p>}
      </section>
      <section className="targets-ai" aria-label="Local AI fleet advisory">
        <header><div><span>LOCAL AI ADVISORY</span><h2>QWEN3 8B · ADVISORY ONLY</h2></div><b data-state={ai?.status ?? "unavailable"}>{ai?.status?.toUpperCase() ?? "UNAVAILABLE"}</b></header>
        <p>{localAiSummary(ai)}</p>
        <dl><div><dt>Context</dt><dd>{ai?.context?.unit_id ?? "UNAVAILABLE"}</dd></div><div><dt>Generated</dt><dd>{iso(ai?.assessment_generated_at)}{ai?.status === "available" && assessmentIsStale(ai, now) ? " · STALE" : ""}</dd></div><div><dt>Latency</dt><dd>{ai?.latency_ms != null ? `${Math.round(ai.latency_ms)} MS` : "UNAVAILABLE"}</dd></div></dl>
        <button type="button" className="targets-action" onClick={() => void refreshAi()} disabled={!!aegis.pending || now - aegis.fleetRequestedAt < 30_000 || loading}>{refreshingAi ? "REFRESHING…" : "REFRESH AI ADVISORY"}</button>
      </section>
      <StormIntelMetricBoard coreState={state} />
    </div>
  )
}
