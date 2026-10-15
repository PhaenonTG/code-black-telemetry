import { useCallback, useEffect, useState } from "react"
import { PageHeader } from "../components/PageHeader"
import { StatusBadge } from "../components/StatusBadge"
import { useCoreOps } from "../core/useCoreOps"
import { getAegisPolicy, getAegisStatus, type AegisPolicyStatus, type AegisStatus } from "../core/aegisFeed"
import {
  fetchRadarControlSettings,
  fetchStatusCenter,
  saveRadarControlSettings,
  type RadarControlSettings,
  type StatusCenterDocument,
  type StatusProject,
  type StatusTile,
} from "../status/statusCenterClient"

const INTERVALS: Array<RadarControlSettings["primary_interval_seconds"]> = [300, 600, 900, 1800]

function stateForBadge(state: string | undefined): "LIVE" | "DEGRADED" | "UNAVAILABLE" | "CHECKING" {
  if (/healthy|live|ok|ready|online/i.test(state ?? "")) return "LIVE"
  if (/degraded|stale|busy|warning/i.test(state ?? "")) return "DEGRADED"
  if (/offline|failed|unavailable|error/i.test(state ?? "")) return "UNAVAILABLE"
  return "CHECKING"
}

function toText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value)
  return "—"
}

function detailFor(tile: StatusTile): string {
  return tile.detail?.trim() || tile.group || "No additional telemetry"
}

export default function StatusCenter() {
  const { config, state } = useCoreOps()
  const [document, setDocument] = useState<StatusCenterDocument | null>(null)
  const [settings, setSettings] = useState<RadarControlSettings | null>(null)
  const [aegis, setAegis] = useState<AegisStatus | null>(null)
  const [aegisPolicy, setAegisPolicy] = useState<AegisPolicyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [nextDocument, nextSettings] = await Promise.all([
        fetchStatusCenter(config),
        fetchRadarControlSettings(config),
      ])
      setDocument(nextDocument)
      setSettings(nextSettings)
      setError(null)
      try { setAegis(await getAegisStatus(config)) } catch { setAegis(null) }
      try { setAegisPolicy(await getAegisPolicy(config)) } catch { setAegisPolicy(null) }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Status Center is unavailable")
    }
  }, [config])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      setSettings(await saveRadarControlSettings(config, settings))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save radar control settings")
    } finally {
      setSaving(false)
    }
  }

  const tiles = document?.summary?.tiles ?? []
  const projects = document?.projects ?? []
  const projectCounts = projects.reduce((counts, project) => {
    if (project.health === "HEALTHY") counts.healthy += 1
    else if (project.health === "UNMONITORED") counts.unmonitored += 1
    else counts.attention += 1
    return counts
  }, { healthy: 0, attention: 0, unmonitored: 0 })
  const radar = document?.radar ?? {}
  const sections = [
    ["RADAR", radar],
    ["STREAMING", document?.streaming ?? {}],
    ["WEATHER", document?.weather ?? {}],
    ["COMPUTE", document?.compute ?? {}],
    ["STORAGE", document?.storage ?? {}],
    ["AI", document?.ai ?? {}],
  ] as const

  return (
    <div className="page page-status-center">
      <PageHeader
        title="STATUS CENTER"
        kicker="LIVE PLATFORM TELEMETRY"
        description={error ? "Verified Core telemetry unavailable" : document?.generated_at ? `Verified Core telemetry · updated ${new Date(document.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Loading verified Core telemetry…"}
        actions={<button type="button" className="page-action-link" onClick={() => { void refresh() }}>REFRESH</button>}
      />

      {error && <p className="status-center__error" role="alert">{error}</p>}

      <section className="status-center__summary" aria-label="Platform summary">
        <div className="status-center__overall">
          <span>PLATFORM STATE</span>
          <StatusBadge state={error ? "UNAVAILABLE" : stateForBadge(document?.summary?.overall)} />
          <b>{error ? "UNAVAILABLE" : document?.summary?.overall ?? "CHECKING"}</b>
          <small>{error ? "Current attention count unavailable" : document?.summary ? `${document.summary.attention_count} active attention item(s)` : "Attention count unavailable"}</small>
        </div>
        <div className="status-center__tiles">
          {tiles.map((tile) => <article key={tile.id} className="status-center__tile">
            <span>{tile.label}</span>
            <StatusBadge state={stateForBadge(tile.state)} />
            <p>{detailFor(tile)}</p>
          </article>)}
        </div>
      </section>

      <section className="status-landscape" aria-label="Project landscape">
        <div className="status-landscape__header">
          <div><span className="status-landscape__eyebrow">CODE BLACK // MISSION GRID</span><h2>PROJECT LANDSCAPE</h2><p>Rollout phase and live service health across the operation.</p></div>
          <div className="status-landscape__counts" aria-label="Project health counts">
            <div><b>{projects.length}</b><span>PROJECTS</span></div>
            <div><b>{projectCounts.healthy}</b><span>CLEAR</span></div>
            <div><b>{projectCounts.attention}</b><span>CHECK</span></div>
            <div><b>{projectCounts.unmonitored}</b><span>NO PROBE</span></div>
          </div>
        </div>
        {error ? <p className="status-center__muted">Project health is unavailable while Core telemetry is disconnected.</p> : !document ? <p className="status-center__muted">Loading mission grid…</p> : projects.length === 0 ? <p className="status-center__muted">Core has not published the project landscape yet.</p> :
          <div className="status-landscape__grid">{projects.map((project: StatusProject, index) => <article key={project.id} className={`status-landscape__card status-landscape__card--${project.health.toLowerCase()}`}>
            <div className="status-landscape__card-top"><span className="status-landscape__number">{String(index + 1).padStart(2, "0")} / {String(projects.length).padStart(2, "0")}</span><span className="status-landscape__health"><StatusBadge state={stateForBadge(project.health)} /><b>{project.health}</b></span></div>
            <h3>{project.name}</h3>
            <div className="status-landscape__phase">{project.phase}</div>
            <p>{project.summary}</p>
            <div className="status-landscape__coverage"><span>SERVICE COVERAGE</span><b>{project.monitored_count} / {project.expected_count}</b></div>
            <div className="status-landscape__meter" aria-hidden="true"><i style={{ width: project.expected_count ? `${Math.min(100, 100 * project.monitored_count / project.expected_count)}%` : "0%" }} /></div>
            <details><summary>VIEW SIGNALS <span>{project.services.length}</span></summary>
              <ul>{project.services.map((service) => <li key={service.id}><span>{service.name}<small>{service.host}</small></span><b className={`status-landscape__signal status-landscape__signal--${service.state.toLowerCase()}`} title={service.state_reason ?? undefined}>{service.state}</b></li>)}</ul>
              {project.missing_services.length > 0 && <p className="status-landscape__missing">Missing probes: {project.missing_services.join(", ")}</p>}
            </details>
            <p className="status-landscape__note">{project.note}</p>
            {project.links.length > 0 && <div className="status-landscape__links">{project.links.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer">{link.name} ↗</a>)}</div>}
          </article>)}</div>}
      </section>

      <div className="status-center__grid">
        <section className="status-center__panel">
          <h2>RADAR CONTROL</h2>
          <div className="status-center__facts">
            <div><span>WORKER</span><b>{toText((radar.worker as Record<string, unknown> | undefined)?.state)}</b></div>
            <div><span>PIPELINE</span><b>{toText(radar.state)}</b></div>
            <div><span>TELEMETRY</span><b>{error || !document ? "UNAVAILABLE" : toText((radar.telemetry as Record<string, unknown> | undefined)?.stale) === "true" ? "STALE" : (radar.telemetry ? "CURRENT" : "UNKNOWN")}</b></div>
          </div>
          <div className="status-center__facts">
            <div><span>AEGIS SCREEN</span><b>{aegis?.screen.enabled ? "RUNNING" : "UNAVAILABLE"}</b></div>
            <div><span>ALERT DELIVERY</span><b>{aegis?.delivery_enabled ? "LIVE" : "SHADOW / OFF"}</b></div>
            <div><span>EVIDENCE CUTOFF</span><b>{aegis?.screen.cutoff ?? "—"}/100</b></div>
          </div>
          <div className="status-center__facts">
            <div><span>FABRIC LIVE STREAM</span><b>{state.fabric.streamState === "open" && state.fabric.lastStreamEventAt !== null
              && Date.now() - state.fabric.lastStreamEventAt < 10_000 ? "LIVE" : state.fabric.streamState.toUpperCase()}</b></div>
            <div><span>LAST STREAM FRAME</span><b>{state.fabric.lastStreamEventAt
              ? new Date(state.fabric.lastStreamEventAt).toLocaleTimeString() : "—"}</b></div>
            <div><span>RADAR REVIEW</span><b><a href="/aegis-alerts">OPEN SHADOW SCANS</a></b></div>
          </div>
          <div className="status-center__facts">
            <div><span>POLICY DRAFT</span><b>{aegisPolicy?.current_draft ? `REV ${aegisPolicy.current_draft.revision}` : "UNAVAILABLE"}</b></div>
            <div><span>ACTIVATION</span><b>{aegisPolicy?.activation_locked ? "LOCKED" : "UNKNOWN"}</b></div>
            <div><span>DRAFT EFFECT</span><b>{aegisPolicy?.drafts_affect_live_scanner === false ? "NONE" : "UNKNOWN"}</b></div>
          </div>
          <p className="status-center__muted"><a href="/aegis-alerts">Open Aegis radar alert feed and evidence map</a> · <a href="/automation-lab">Rehearse alert workflow</a> · Supplemental, not an official warning.</p>
          {settings ? <details className="status-center__admin"><summary>Admin radar policy</summary><div className="status-center__controls">
            <label className="settings-toggle-row">
              <span className="settings-toggle-row__text"><b className="settings-toggle-row__label">Primary-site prewarm</b><small className="settings-toggle-row__description">Prewarm the closest active radar site before acquisition.</small></span>
              <span className={`switch ${settings.primary_prewarm_enabled ? "switch--on" : ""}`}><input type="checkbox" checked={settings.primary_prewarm_enabled} onChange={(event) => setSettings({ ...settings, primary_prewarm_enabled: event.target.checked })} /><i /></span>
            </label>
            <label className="status-center__select">INTERVAL
              <select value={settings.primary_interval_seconds} onChange={(event) => setSettings({ ...settings, primary_interval_seconds: Number(event.target.value) as RadarControlSettings["primary_interval_seconds"] })}>
                {INTERVALS.map((seconds) => <option key={seconds} value={seconds}>{seconds / 60} minutes</option>)}
              </select>
            </label>
            <button type="button" className="settings-save" disabled={saving} onClick={() => { void save() }}>{saving ? "SAVING…" : "SAVE RADAR POLICY"}</button>
          </div></details> : <p className="status-center__muted">{error ? "Radar policy unavailable." : "Radar policy is loading…"}</p>}
        </section>

        <section className="status-center__panel">
          <h2>ATTENTION QUEUE</h2>
          {error ? <p className="status-center__muted">Current attention queue unavailable. Previously received items may be out of date.</p> : !document ? <p className="status-center__muted">Loading attention queue…</p> : (document.attention ?? []).length === 0 ? <p className="status-center__muted">No active operator attention items.</p> : <div className="status-center__attention">
            {document?.attention?.map((item) => <article key={item.id}>
              <span>{item.severity ?? "NOTICE"}</span><b>{item.title}</b><p>{item.detail ?? "No detail provided"}</p>
            </article>)}
          </div>}
        </section>
      </div>

      <section className="status-center__telemetry">
        <h2>SUBSYSTEM TELEMETRY</h2>
        <div>{sections.map(([label, data]) => <article key={label}>
          <span>{label}</span><StatusBadge state={stateForBadge(toText(data.state))} />
          <p>{toText(data.summary ?? data.note ?? (data.telemetry && (data.telemetry as Record<string, unknown>).last_success))}</p>
        </article>)}</div>
      </section>
    </div>
  )
}
