import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useDesk } from "./DeskProvider"
import { ageLabel, bearing, coordinates, distanceMiles, localTime, numberField } from "./format"
import { assessmentSections, assessmentSummary, localAiSummary } from "../localAiAdvisory"
import { assessmentIsStale, fleetContextMatches, reviewMatchesPoint, reviewPointKey } from "./aegisReview"
import { coreConfigured } from "../core/config"
import { useCoreOps } from "../core/useCoreOps"
import type { AlertProduct } from "../../../../src/services/situational"
import { MapSituationPanel } from "../components/MapSituationPanel"
import { MapCameraViewer } from "../components/MapCameraViewer"
import { CameraFeed } from "./CameraFeed"
import { Icon } from "../components/Icon"

export function Panel({ title, meta, children, className = "" }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`desk-panel ${className}`}><header className="desk-panel__heading"><h2>{title}</h2>{meta && <span>{meta}</span>}</header>{children}</section>
}
export function Empty({ children }: { children: ReactNode }) { return <p className="desk-empty">{children}</p> }
export function OfficialAlerts({ compact = false }: { compact?: boolean }) {
  const { alerts, alertsError, alertsCheckedAt, reference, now } = useDesk()
  const [selected, setSelected] = useState<AlertProduct | null>(null)
  return <Panel title="Official alerts" meta={<span className="desk-source">NWS / SPC{alertsCheckedAt ? ` · ${ageLabel(alertsCheckedAt, now)}` : ""}</span>} className={compact ? "desk-official desk-official--compact" : "desk-official"}>
    {!reference ? <Empty>Position required for local alerts.</Empty> : alertsError ? <p className="desk-source-warning">Alert check failed. Last received products shown below. <a href="https://www.weather.gov/" target="_blank" rel="noreferrer">Check NWS ↗</a></p> : !alertsCheckedAt ? <Empty>Checking official products…</Empty> : alerts.length === 0 ? <Empty>No active products returned for this position.</Empty> : null}
    {alerts.slice(0, compact ? 1 : 4).map((alert) => <button className={`desk-alert desk-alert--${alert.type}`} key={alert.id} onClick={() => setSelected(alert)}><span><strong>{alert.title}</strong><small>{alert.area || alert.headline}</small></span><span className="desk-alert__time">{Math.max(0, Math.ceil((Date.parse(alert.expires) - now) / 60_000))}m left <Icon name="chevron" /></span></button>)}
    {alerts.length > (compact ? 1 : 4) && <Link className="desk-inline-link" to="/weather">{alerts.length} active products · Open all →</Link>}
    {selected && <div className="desk-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}><MapSituationPanel modal selection={{ kind: "alert", alert: selected }} onClose={() => setSelected(null)} /></div>}
  </Panel>
}
export function TeamPanel() {
  const { units, preferences, activeUnit, updatePreferences, now } = useDesk()
  return <Panel title="Team" meta={<Link to="/fleet">Devices ↗</Link>}><div className="desk-team">
    {units.length === 0 && <Empty>No unit telemetry received.</Empty>}
    {units.map((unit) => <button key={unit.unit_id} className={`desk-team__row ${activeUnit?.unit_id === unit.unit_id ? "is-selected" : ""}`} onClick={() => updatePreferences({ unitId: unit.unit_id })} aria-pressed={activeUnit?.unit_id === unit.unit_id}><i className="desk-presence" data-live={unit.overall_health !== "OFFLINE" && !!unit.last_seen && now - unit.last_seen >= -60_000 && now - unit.last_seen < 120_000} /><span><strong>{unit.operator_name || unit.display_name}</strong><small>{unit.display_name} · {unit.role}</small></span><span>{ageLabel(unit.last_seen, now)}</span></button>)}
    {preferences.unitId && <button className="desk-inline-link" onClick={() => updatePreferences({ unitId: "" })}>Use default unit</button>}
  </div></Panel>
}
export function AegisPanel({ scope = "fleet" }: { scope?: "fleet" | "point" }) {
  const { ai, errors, now, aegis, reviewSelection, choosePoint, activeUnit, observation } = useDesk()
  const { config } = useCoreOps()
  const key = reviewPointKey(reviewSelection?.point)
  const saved = key ? aegis.reviews[key] : null
  const pointReview = saved?.value && reviewMatchesPoint(saved.value, reviewSelection?.point) ? saved.value : null
  const value = scope === "point" ? pointReview : ai
  const timestamp = scope === "point" ? pointReview?.generated_at : ai?.assessment_generated_at
  const stale = assessmentIsStale(value, now)
  const requestError = scope === "point" ? saved?.error : aegis.fleetError
  const requestedAt = scope === "point" ? saved?.requestedAt ?? 0 : aegis.fleetRequestedAt
  const cooldown = Math.max(0, Math.ceil((requestedAt + 30_000 - now) / 1000))
  const unitMatch = fleetContextMatches(ai, activeUnit?.unit_id)
  const reviewProducts = pointReview?.radar_evidence.products as Record<string, { observed_at?: string }> | undefined
  const newerRadar = !!pointReview && Object.entries(observation?.radar.products ?? {}).some(([name, product]) => {
    const oldTime = reviewProducts?.[name]?.observed_at
    return product.available && product.observed_at && (!oldTime || Date.parse(product.observed_at) > Date.parse(oldTime))
  })
  const sections = assessmentSections(value)
  const history = Object.values(aegis.reviews).filter((row) => row.value).sort((a, b) => b.requestedAt - a.requestedAt).slice(0, 6)
  return <Panel title="Aegis" meta={<span className="desk-source">Internal · Experimental</span>} className="desk-aegis">
    <div className="desk-panel__body"><span className="desk-eyebrow">{scope === "point" ? "Selected-point review" : "Core unit review"} · {value ? value.status === "available" && stale ? "Stale" : value.status : "Not run"}</span>
    <div className="desk-aegis-context">{scope === "point" ? reviewSelection ? <><strong>{reviewSelection.label}</strong><small>{reviewSelection.point.lat.toFixed(4)}, {reviewSelection.point.lon.toFixed(4)}</small></> : <strong>Select a map point or target</strong> : <><strong>{ai?.context?.unit_id ?? "Core default unit"}</strong><small>{ai?.model?.name ?? "Local model"}</small></>}</div>
    {scope === "fleet" && ai?.context && !unitMatch && <p className="desk-source-warning">{ai.context.unit_id === activeUnit?.unit_id ? "Unit context type was not confirmed." : `This briefing is for ${ai.context.unit_id}, not ${activeUnit?.display_name || "the selected device"}.`}</p>}
    {scope === "point" && reviewSelection?.validTime && <p className="desk-source-warning">Setup valid {localTime(reviewSelection.validTime)}. This endpoint reviews current point conditions, not that forecast hour.</p>}
    {requestError && <p className="desk-source-warning" role="alert">{requestError}{value ? " Last confirmed result retained." : ""}</p>}
    {scope === "fleet" && errors.Aegis && <p className="desk-source-warning">Source check failed. Last published assessment retained.</p>}
    <p className="desk-brief" aria-live="polite">{value ? assessmentSummary(value) : scope === "point" ? "Choose a point and run a local review using Core model fields and radar evidence." : "No published unit assessment received."}</p>
    {timestamp && <small className="desk-muted">{ageLabel(timestamp, now)} · {localTime(timestamp)}{value?.model?.name ? ` · ${value.model.name}` : ""}</small>}
    {newerRadar && <p className="desk-source-warning">Newer radar evidence is available. Review again before using this briefing.</p>}
    <div className="desk-aegis-actions"><button disabled={!coreConfigured(config) || !!aegis.pending || cooldown > 0 || (scope === "point" && !reviewSelection)} onClick={() => void aegis.run(scope === "point" ? reviewSelection ?? undefined : undefined)}>{aegis.pending ? "Local review running…" : cooldown > 0 ? "Review cooldown" : scope === "point" ? "Review point + radar" : "Refresh Core unit review"}</button><small>Local only · On request</small></div>
    {sections.length > 0 && <details><summary>Findings & evidence limits</summary>{sections.map((section) => <div className="desk-aegis-findings" key={section.label}><strong>{section.label}</strong><ul>{section.lines.map((line, index) => <li key={index}>{line}</li>)}</ul></div>)}</details>}
    {!!value?.guard_reasons?.length && <details><summary>Review limits</summary><ul>{value.guard_reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>}
    {pointReview && <details><summary>Review provenance</summary><dl className="desk-aegis-readouts"><div><dt>Radar site</dt><dd>{typeof pointReview.radar_evidence.site_id === "string" ? pointReview.radar_evidence.site_id : "Unavailable"}</dd></div><div><dt>Snapshot</dt><dd>{pointReview.snapshot_id ?? "Not reported"}</dd></div></dl><small className="desk-muted">Core evidence, not pixels from the displayed radar frame. Official alerts remain separate.</small></details>}
    {scope === "point" && history.length > 0 && <details><summary>Session point reviews · {history.length}</summary><div className="desk-aegis-history">{history.map((row) => <button key={reviewPointKey(row.selection.point)} onClick={() => choosePoint(row.selection.point, row.selection)}>{row.selection.point.lat.toFixed(3)}, {row.selection.point.lon.toFixed(3)}<small>{row.value?.status} · {ageLabel(row.value?.generated_at, now)}</small></button>)}</div></details>}
    <small className="desk-muted desk-aegis-cadence">Sources checked each minute. {observation?.executor.state === "not_deployed" ? "Automatic observation analysis is not deployed." : "Executor state: " + (observation?.executor.state ?? "unavailable")}</small>
    <Link className="desk-inline-link" to="/aegis">Observation & source gates →</Link></div>
  </Panel>
}
export function CellPanel() {
  const { cell, cellHistory, choosePoint, now, radarFrame } = useDesk()
  const sample = cell.sample
  const shownSite = radarFrame?.site.id
  return <Panel title="Cell watch" meta={cell.fresh ? sample?.trusted ? "Usable estimate" : "Review needed" : "Unavailable"} className="desk-cell">
    <div className="desk-panel__body">{sample ? <><span className="desk-eyebrow">{sample.site} · Dominant echo · {ageLabel(sample.observedAt, now)}</span>
      <dl className="desk-aegis-readouts"><div><dt>Reflectivity</dt><dd>{sample.maxDbz?.toFixed(1) ?? "—"} dBZ</dd></div><div><dt>Motion estimate</dt><dd>{sample.speedKnots == null || sample.directionDegrees == null ? "Unavailable" : `${Math.round(sample.directionDegrees)}° / ${Math.round(sample.speedKnots)} kt`}</dd></div><div><dt>Confidence</dt><dd>{sample.confidence}</dd></div><div><dt>Scan spacing</dt><dd>{sample.sampleSpanMinutes == null ? "Unknown" : `${sample.sampleSpanMinutes.toFixed(1)} min`}</dd></div></dl>
      {cell.reason && <p className="desk-source-warning">{cell.reason}</p>}
      {shownSite && shownSite !== sample.site && <p className="desk-source-warning">Viewing {shownSite}; Core cell evidence is from {sample.site}.</p>}
      <button disabled={!cell.fresh} onClick={() => choosePoint(sample.point, { label: `${sample.site} dominant echo` })}>Select echo for Aegis review</button>
    </> : <Empty>{cell.reason}</Empty>}
    <small className="desk-muted">Two-scan dominant-echo centroid, not multi-cell identity tracking or tornado detection.</small>
    {cellHistory.length > 0 && <details><summary>Recent observations · {cellHistory.length}</summary><ol className="desk-cell-history">{cellHistory.slice(-6).reverse().map((row) => <li key={`${row.site}-${row.id}-${row.observedAt}`}><strong>{row.site} · {localTime(row.observedAt)}</strong><span>{row.point.lat.toFixed(3)}, {row.point.lon.toFixed(3)} · {row.maxDbz?.toFixed(1) ?? "—"} dBZ · {row.trusted ? "Usable" : "Review needed"}</span></li>)}</ol><small className="desk-muted">Session samples only. A dominant echo can change storms; samples are not joined into a storm trail.</small></details>}</div>
  </Panel>
}
export function ChangesPanel() {
  const { ai, previousAi, roadResult, now } = useDesk()
  const changed = previousAi && ai && localAiSummary(previousAi) !== localAiSummary(ai)
  const roads = [...(roadResult?.data ?? [])].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 3)
  return <Panel title="What changed" meta="This session"><div className="desk-change-list">
    {roadResult && !["ready", "empty"].includes(roadResult.status) && <p className="desk-source-warning">{roadResult.message || "Road source unavailable. Last received events may be stale."}</p>}
    {changed && <div><i /><span><strong>Aegis assessment updated</strong><small>{ageLabel(ai.assessment_generated_at ?? ai.generated_at, now)}</small></span></div>}
    {roads.map((road) => <div key={road.id}><i /><span><strong>{road.title}</strong><small>{road.closureState} · {ageLabel(road.updatedAt, now)}{road.freshness === "stale" ? " · Stale" : ""}</small></span></div>)}
    {!changed && roads.length === 0 && <Empty>No changes captured in this session.</Empty>}
    <Link className="desk-inline-link" to="/field">Reports & road details →</Link>
  </div></Panel>
}
export function CameraPanel({ small = false }: { small?: boolean }) {
  const { cameras, primaryCamera: camera, preferences, updatePreferences, pinnedCameras, togglePin, cameraResult, now } = useDesk()
  const [expanded, setExpanded] = useState(false)
  return <Panel title="Camera desk" meta={<Link to="/map">Find on map ↗</Link>} className={small ? "desk-cameras desk-cameras--small" : "desk-cameras"}>
    {camera ? <><div className="desk-camera-name"><span><strong>{camera.name}</strong><small>{camera.roadway || camera.provider.displayLabel} · {ageLabel(camera.lastUpdateAt, now)}</small></span><button aria-label="Expand selected camera" onClick={() => setExpanded(true)}><Icon name="expand" /></button></div>
      {expanded ? <div className="desk-camera-feed desk-camera-feed--expanded"><span>Camera open in expanded view</span></div> : <CameraFeed key={`${camera.id}-${preferences.snapshotMode}`} camera={camera} snapshot={preferences.snapshotMode} />}
      {expanded && <MapCameraViewer expanded camera={camera} onClose={() => setExpanded(false)} pinned={pinnedCameras.some((row) => row.id === camera.id)} onTogglePin={() => togglePin(camera)} lowBandwidth={preferences.snapshotMode} onLowBandwidthChange={(snapshotMode) => updatePreferences({ snapshotMode })} />}
      <div className="desk-camera-actions"><button onClick={() => togglePin(camera)} aria-pressed={pinnedCameras.some((row) => row.id === camera.id)}><Icon name="pin" /> {pinnedCameras.some((row) => row.id === camera.id) ? "Pinned" : "Pin camera"}</button><button onClick={() => updatePreferences({ snapshotMode: !preferences.snapshotMode })} aria-pressed={preferences.snapshotMode}>{preferences.snapshotMode ? "Snapshot mode" : "Stream mode"}</button>{camera.sourceUrl && <a href={camera.sourceUrl} target="_blank" rel="noreferrer">Provider ↗</a>}</div>
      <div className="desk-camera-rail" aria-label="Select camera">{cameras.slice(0, 12).map((row) => <button key={row.id} aria-pressed={camera.id === row.id} onClick={() => updatePreferences({ primaryCameraId: row.id })}>{row.thumbnailUrl || row.previewUrl || row.imageUrl ? <img src={row.thumbnailUrl || row.previewUrl || row.imageUrl || undefined} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = "hidden" }} /> : <Icon name="camera" />}<span>{row.name}</span><small>{row.freshness === "stale" ? "Stale" : row.streamUrl ? "Video source" : "Snapshot"}</small></button>)}</div></> : <div className="desk-camera-empty"><Icon name="camera" /><h3>No camera selected</h3><p>Pin a camera on the map, or allow location to find nearby feeds.</p><Link to="/map">Open camera map →</Link></div>}
    {cameraResult && !["ready", "empty"].includes(cameraResult.status) && <p className="desk-source-warning">{cameraResult.message || "Camera source check failed. Saved feeds may be stale."}</p>}
  </Panel>
}
export function TargetPanel() {
  const { settings, reference, errors, choosePoint } = useDesk()
  const raw = settings as unknown as Record<string, unknown> | null
  const target = settings?.target?.enabled ? coordinates(raw?.target as Record<string, unknown> | undefined) : null
  const direction = target && reference ? bearing(reference, target) : null
  return <Panel title="Current target" meta={<Link to="/targets">Target planning ↗</Link>}><div className="desk-panel__body">{target ? <><strong className="desk-value">{reference ? `${Math.round(distanceMiles(reference, target))} mi` : "Position needed"}</strong><p>{direction ? `${direction} · Straight-line distance` : `${target.lat.toFixed(3)}, ${target.lon.toFixed(3)}`}</p><button onClick={() => choosePoint(target, { label: settings?.target.label || "Armed target" })}>Select target for Aegis</button></> : <Empty>{errors.Target ? "Target source unavailable." : "No target coordinates published."}</Empty>}<Link className="desk-inline-link" to="/targets">Review target & departure guidance →</Link></div></Panel>
}
export function UnitStrip() {
  const { activeUnit, reference, referenceLabel, unitPosition, now } = useDesk()
  const weather = unitPosition ? activeUnit?.weather : null
  const temperature = numberField(weather, "temperature_f", "temp_f", "tempF")
  const dewpoint = numberField(weather, "dewpoint_f", "dew_point_f", "dewpointF")
  const wind = numberField(weather, "wind_speed_mph", "wind_mph", "windSpeedMph")
  return <section className="desk-unit-strip" aria-label="Current unit telemetry"><div><span className="desk-eyebrow">{referenceLabel}</span><strong>{unitPosition ? activeUnit?.display_name || "Chase unit" : "Field desk"}</strong><small>{reference ? `${reference.lat.toFixed(3)}, ${reference.lon.toFixed(3)}` : "No position"}{unitPosition ? ` · ${ageLabel(activeUnit?.last_seen, now)}` : ""}</small></div><div><strong>{temperature == null ? "—" : `${Math.round(temperature)}°`}</strong><span>Temperature</span></div><div><strong>{dewpoint == null ? "—" : `${Math.round(dewpoint)}°`}</strong><span>Dewpoint</span></div><div><strong>{wind == null ? "—" : Math.round(wind)}</strong><span>Wind mph</span></div></section>
}
