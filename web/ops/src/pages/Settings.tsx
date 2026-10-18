import { useEffect, useState, type CSSProperties } from "react"
import { loadAppTheme, saveAppTheme, subscribeAppTheme, type AppThemeMode } from "../../../../src/services/settings"
import { loadMapLayerVisibility, saveMapLayerVisibility, subscribeMapLayerVisibility, type MapLayerVisibility } from "../../../../src/services/settings"
import { PageHeader } from "../components/PageHeader"
import { Icon } from "../components/Icon"
import { useAuth } from "../auth/AuthProvider"
import { Link } from "react-router-dom"
import { loadWeatherAlertRuntimeStatus, loadWeatherAlertSettings, saveWeatherAlertSettings, type WeatherAlertRuntimeStatus, type WeatherAlertSettings } from "../weatherAlertSettings"
import { useCoreOps } from "../core/useCoreOps"


// Page-scoped brand styling (no Settings CSS file is in the allowed list). Motion only under
// prefers-reduced-motion: no-preference, transform/opacity only.
const SETTINGS_BRAND_CSS = `
.shell .page-settings--brand .page-header h1{font-family:Anton,Inter,ui-sans-serif,system-ui,sans-serif;font-weight:400;letter-spacing:.04em}
.shell .page-settings--brand .settings-group{position:relative;overflow:hidden;border:1px solid var(--cb-line);border-top:1px solid var(--cb-line);border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,0) 38%),repeating-linear-gradient(90deg,rgba(255,255,255,.012) 0 1px,transparent 1px 3px),linear-gradient(160deg,var(--cb-panel-hi),var(--cb-panel) 70%);box-shadow:0 10px 28px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.05)}
.shell .page-settings--brand .settings-group::before{content:"";position:absolute;left:16px;right:16px;top:0;height:1px;background:linear-gradient(90deg,transparent,var(--cb-red) 15%,var(--cb-red) 85%,transparent);box-shadow:0 0 10px rgba(255,42,12,.7);pointer-events:none}
.shell .page-settings--brand .settings-group h2{color:var(--cb-gray);letter-spacing:.16em}
.shell .page-settings--brand .settings-toggle-list h3{color:var(--cb-amber)}
.shell .page-settings--brand .segmented{border-radius:10px;background:var(--cb-panel-low)}
.shell .page-settings--brand .segmented button.active{background:var(--cb-red);color:#000;box-shadow:0 0 12px -2px rgba(255,42,12,.8)}
.shell .page-settings--brand .switch--on i{box-shadow:0 0 10px -1px rgba(255,42,12,.85)}
.shell .page-settings--brand .settings-number input{border-radius:8px;border:1px solid var(--cb-line);background:var(--cb-panel-low);color:var(--cb-text);padding:6px 10px}
.shell .page-settings--brand .settings-number input:focus-visible{outline:2px solid var(--cb-red);outline-offset:2px}
.shell .page-settings--brand .settings-save,.shell .page-settings--brand .page-action-link{border-radius:8px;border:1px solid rgba(255,42,12,.55);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,0))}
.shell .page-settings--brand .settings-save:hover:not(:disabled),.shell .page-settings--brand .page-action-link:hover{border-color:var(--cb-red);box-shadow:0 0 14px -4px rgba(255,42,12,.85)}
.shell .page-settings--brand .settings-logout{border-radius:8px}
@media (prefers-reduced-motion:no-preference){
.shell .page-settings--brand .settings-group{animation:cb-settings-in 380ms cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--cb-i,0) * 70ms)}
.shell .page-settings--brand :is(.settings-save,.page-action-link,.segmented button){transition:box-shadow 220ms cubic-bezier(.2,.8,.2,1),border-color 180ms,background 180ms,transform 160ms}
.shell .page-settings--brand :is(.settings-save,.page-action-link):active{transform:scale(.98)}
@keyframes cb-settings-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
}
`

const THEME_OPTIONS: AppThemeMode[] = ["dark", "night", "system", "light"]

// MapLayerVisibility's keys are internal identifiers (src/services/settings.ts), not copy --
// this is the one place they get a human-readable name and a one-line description of what
// toggling them actually does, instead of surfacing the raw camelCase key to the user.
const LAYER_LABELS: Record<string, { label: string; description: string }> = {
  warnings: { label: "Warnings", description: "Tornado, PDS, Severe Thunderstorm, and Flash Flood Warning polygons" },
  watches: { label: "Watches", description: "Tornado and Severe Thunderstorm Watch boxes" },
  mesoscaleDiscussions: { label: "Mesoscale discussions", description: "SPC forecaster discussions ahead of a watch or warning" },
  specialStatements: { label: "Special statements", description: "Special Weather Statements and other advisory-level NWS products" },
  team: { label: "Team positions", description: "Live location of other Code Black team members" },
  chasers: { label: "Spotter network", description: "Nearby public storm spotter positions" },
  poi: { label: "Points of interest", description: "Named landmarks and reference points" },
  mosaic: { label: "Wide-area mosaic", description: "Regional composite radar reflectivity" },
  radar: { label: "Single-site radar", description: "High-resolution radar from the nearest site" },
  roadConditions: { label: "Road conditions", description: "DOT-reported closures and hazards" },
  trafficCameras: { label: "Traffic cameras", description: "Public DOT traffic camera feeds" },
  surfaceStations: { label: "Surface observations", description: "Nearby METAR and ASOS temperature, dewpoint, and wind reports" },
  stormReports: { label: "Recent storm reports", description: "NWS and Spotter Network reports from the last two hours" },
  riverGauges: { label: "River gauges", description: "USGS gauge height and recent rise or fall rate at zoom 5 and closer" },
  probes: { label: "Probe deployments", description: "Deployed instrument probe locations" },
  chaserNet: { label: "Chaser Net reports", description: "Community-submitted ground truth reports" },
  breadcrumbs: { label: "GPS trail", description: "Your own recent movement history on the map" },
}

const LAYER_GROUPS = [
  { title: "WEATHER", keys: ["warnings", "watches", "mesoscaleDiscussions", "specialStatements", "mosaic", "radar", "surfaceStations", "stormReports", "riverGauges"] },
  { title: "FIELD", keys: ["team", "chasers", "probes", "chaserNet", "breadcrumbs"] },
  { title: "ROADS & PLACES", keys: ["roadConditions", "trafficCameras", "poi"] },
] as const

// A working foundation, not the full settings surface -- reuses the real settings.ts load/save/
// subscribe layer (same @capacitor/preferences-backed storage the native app uses, with the web
// fallback confirmed safe in docs/ARCHITECTURE.md) for two representative settings groups. Map,
// Road Conditions, Cameras, Notifications, etc. are documented as follow-up work, not faked here.
export default function Settings() {
  const auth = useAuth()
  const { config } = useCoreOps()
  const [theme, setTheme] = useState<AppThemeMode>("dark")
  const [layers, setLayers] = useState<MapLayerVisibility | null>(null)
  const [alertSettings, setAlertSettings] = useState<WeatherAlertSettings | null>(null)
  const [alertRuntime, setAlertRuntime] = useState<WeatherAlertRuntimeStatus | null>(null)
  const [alertError, setAlertError] = useState<string | null>(null)
  const [alertSaving, setAlertSaving] = useState(false)
  // Last settings confirmed by the server (load or save). Used only to tell the operator whether
  // on-screen edits are still unsaved; no extra request is made.
  const [alertSaved, setAlertSaved] = useState<WeatherAlertSettings | null>(null)
  const [alertSavedNotice, setAlertSavedNotice] = useState(false)

  useEffect(() => {
    const unsub = subscribeAppTheme(setTheme)
    void loadAppTheme()
    return unsub
  }, [])
  useEffect(() => {
    void loadWeatherAlertSettings(config).then((loaded) => { setAlertSettings(loaded); setAlertSaved(loaded) }).catch(() => setAlertError("Weather alert controls are unavailable."))
    void loadWeatherAlertRuntimeStatus(config).then(setAlertRuntime).catch(() => undefined)
  }, [config])

  const saveAlerts = async () => {
    if (!alertSettings) return
    setAlertSaving(true); setAlertError(null); setAlertSavedNotice(false)
    try { const saved = await saveWeatherAlertSettings(config, alertSettings); setAlertSettings(saved); setAlertSaved(saved); setAlertSavedNotice(true) }
    catch { setAlertError("Could not save weather alert controls. No change was confirmed.") }
    finally { setAlertSaving(false) }
  }
  const alertDirty = !!alertSettings && !!alertSaved && JSON.stringify(alertSettings) !== JSON.stringify(alertSaved)
  useEffect(() => {
    const unsub = subscribeMapLayerVisibility(setLayers)
    void loadMapLayerVisibility()
    return unsub
  }, [])

  return (
    <div className="page page-settings page-settings--brand">
      <style href="cb-brand-settings" precedence="default">{SETTINGS_BRAND_CSS}</style>
      <PageHeader title="SETTINGS" kicker="DISPLAY · MAP · ALERTS · SESSION" description="Display and map-layer defaults apply immediately and persist on this device. Weather alert controls change the shared alert pipeline and apply only after you save them." />

      <section className="settings-group" style={{ "--cb-i": 0 } as CSSProperties}>
        <h2>Display</h2>
        <p className="settings-alert-copy">Applies immediately on this device.</p>
        <div className="settings-row">
          <span>Theme</span>
          <div className="segmented">
            {THEME_OPTIONS.map((mode) => (
              <button key={mode} type="button" className={theme === mode ? "active" : ""} onClick={() => void saveAppTheme(mode)}>
                {mode}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-group settings-group--layers" style={{ "--cb-i": 1 } as CSSProperties}>
        <h2>Map layer defaults</h2>
        <p className="settings-alert-copy">Applies immediately and persists on this device.</p>
        {layers ? (
          <div className="settings-layer-grid">
            {LAYER_GROUPS.map((group) => <div className="settings-toggle-list" key={group.title}>
              <h3>{group.title}</h3>
              {group.keys.map((key) => {
                const value = layers[key]
                const copy = LAYER_LABELS[key]
                return <label key={key} className="settings-toggle-row">
                    <span className="settings-toggle-row__text"><span className="settings-toggle-row__label">{copy.label}</span><span className="settings-toggle-row__description">{copy.description}</span></span>
                    <span className={value ? "switch switch--on" : "switch"}><input type="checkbox" checked={!!value} onChange={(e) => void saveMapLayerVisibility({ ...layers, [key]: e.target.checked })} /><i /></span>
                  </label>
              })}
            </div>)}
          </div>
        ) : (
          <p className="page-empty">Loading…</p>
        )}
      </section>

      <section className="settings-group settings-group--data" style={{ "--cb-i": 2 } as CSSProperties}>
        <h2>Data & diagnostics</h2>
        <p>Provider health, radar availability, camera totals, and Core connectivity are tracked on the System page.</p>
        <Link className="page-action-link" to="/system">OPEN SYSTEM HEALTH</Link>
      </section>

      <section className="settings-group settings-group--alerts" style={{ "--cb-i": 3 } as CSSProperties}>
        <h2>Weather alert controls</h2>
        <p className="settings-alert-copy">These settings control Discord alert intake and routing. Edits here are not applied until you select SAVE WEATHER ALERT CONTROLS; then they apply to the live alert pipeline.</p>
        {alertRuntime && <div className="settings-layer-grid settings-alert-telemetry">
          <div className="settings-toggle-list"><h3>DELIVERY TELEMETRY</h3>
            <div className="settings-row"><span>Transport</span><strong>{alertRuntime.transport === "nwws" ? "NWWS REALTIME" : "NWS API · 15 SEC"}</strong></div>
            <div className="settings-row"><span>Latest latency</span><strong>{formatLatency(alertRuntime.latency.latest_issue_to_discord_ms)}</strong></div>
            <div className="settings-row"><span>P50 / P95</span><strong>{formatLatency(alertRuntime.latency.p50_issue_to_discord_ms)} / {formatLatency(alertRuntime.latency.p95_issue_to_discord_ms)}</strong></div>
          </div>
          <div className="settings-toggle-list"><h3>ACTIVE TARGET MATCH</h3>
            {alertRuntime.target ? <><div className="settings-row"><span>{alertRuntime.target.target.label}</span><strong>{alertRuntime.target.warning.title}</strong></div><div className="settings-row"><span>Motion</span><strong>{alertRuntime.target.motion.heading_deg}° · {alertRuntime.target.motion.speed_mph} mph</strong></div><div className="settings-row"><span>Projected</span><strong>{alertRuntime.target.projected.map((point) => `${point.minutes}m ${point.lat.toFixed(2)}, ${point.lon.toFixed(2)}`).join(" · ")}</strong></div></> : <p className="page-empty">No active warning matched to the selected target.</p>}
          </div>
        </div>}
        {alertSettings ? <>
          <div className="settings-layer-grid">
            <div className="settings-toggle-list"><h3>ALERT TYPES</h3>
              {([ ["tornado_warnings", "Tornado warnings"], ["nwws_realtime", "NWWS realtime"], ["spc_md", "SPC mesoscale discussions"], ["spc_day1", "SPC Day 1 outlook"], ["significant_lsr", "Significant local storm reports"] ] as const).map(([key, label]) => <label key={key} className="settings-toggle-row"><span className="settings-toggle-row__text"><span className="settings-toggle-row__label">{label}</span></span><span className={alertSettings.enabled[key] ? "switch switch--on" : "switch"}><input type="checkbox" checked={alertSettings.enabled[key]} onChange={(e) => setAlertSettings({ ...alertSettings, enabled: { ...alertSettings.enabled, [key]: e.target.checked } })} /><i /></span></label>)}
            </div>
            <div className="settings-toggle-list"><h3>CHASE TARGET</h3>
              <label className="settings-toggle-row"><span className="settings-toggle-row__text"><span className="settings-toggle-row__label">Track official warning motion</span></span><span className={alertSettings.target.enabled ? "switch switch--on" : "switch"}><input type="checkbox" checked={alertSettings.target.enabled} onChange={(e) => setAlertSettings({ ...alertSettings, target: { ...alertSettings.target, enabled: e.target.checked } })} /><i /></span></label>
              <AlertNumber label="Match radius (mi)" value={alertSettings.target.match_radius_miles} onChange={(value) => setAlertSettings({ ...alertSettings, target: { ...alertSettings.target, match_radius_miles: value } })} />
              <AlertNumber label="Target latitude" value={alertSettings.target.lat ?? 0} onChange={(value) => setAlertSettings({ ...alertSettings, target: { ...alertSettings.target, lat: value } })} />
              <AlertNumber label="Target longitude" value={alertSettings.target.lon ?? 0} onChange={(value) => setAlertSettings({ ...alertSettings, target: { ...alertSettings.target, lon: value } })} />
            </div>
          </div>
          <div className="settings-layer-grid"><div className="settings-toggle-list"><h3>ROUTING</h3>
            <label className="settings-toggle-row"><span className="settings-toggle-row__text"><span className="settings-toggle-row__label">Use live chase location</span></span><span className={alertSettings.routing.use_live_location ? "switch switch--on" : "switch"}><input type="checkbox" checked={alertSettings.routing.use_live_location} onChange={(e) => setAlertSettings({ ...alertSettings, routing: { ...alertSettings.routing, use_live_location: e.target.checked } })} /><i /></span></label>
            <AlertNumber label="Live radius (mi)" value={alertSettings.routing.live_radius_miles} onChange={(value) => setAlertSettings({ ...alertSettings, routing: { ...alertSettings.routing, live_radius_miles: value } })} />
            <AlertNumber label="Manual radius (mi)" value={alertSettings.routing.manual_radius_miles} onChange={(value) => setAlertSettings({ ...alertSettings, routing: { ...alertSettings.routing, manual_radius_miles: value } })} />
          </div><div className="settings-toggle-list"><h3>FILTERS</h3>
            <AlertNumber label="Minimum hail (in)" value={alertSettings.filters.lsr_min_hail_inches} step="0.25" onChange={(value) => setAlertSettings({ ...alertSettings, filters: { ...alertSettings.filters, lsr_min_hail_inches: value } })} />
            <AlertNumber label="Minimum wind (mph)" value={alertSettings.filters.lsr_min_wind_mph} onChange={(value) => setAlertSettings({ ...alertSettings, filters: { ...alertSettings.filters, lsr_min_wind_mph: value } })} />
          </div></div>
          {alertError && <p className="page-empty" role="alert">{alertError}</p>}
          <p className="settings-alert-copy" role="status">{alertSaving ? "Saving weather alert controls…" : alertDirty ? "Unsaved changes. The live alert pipeline still uses the last saved controls." : alertSavedNotice ? "Saved. The live alert pipeline now uses these controls." : "No unsaved changes."}</p>
          <button type="button" className="page-action-link settings-save" disabled={alertSaving} onClick={() => void saveAlerts()}>{alertSaving ? "SAVING…" : "SAVE WEATHER ALERT CONTROLS"}</button>
        </> : <p className="page-empty">{alertError ?? "Loading…"}</p>}
      </section>

      {auth.status === "authorized" && (
        <section className="settings-group" style={{ "--cb-i": 4 } as CSSProperties}>
          <h2>Session</h2>
          <div className="settings-row">
            <span>{auth.session.user.email}</span>
            <span className="settings-role">{auth.profile.role}</span>
          </div>
          <button type="button" className="settings-logout" onClick={() => void auth.signOut()}>
            <Icon name="logout" />
            Log out
          </button>
        </section>
      )}
    </div>
  )
}

function AlertNumber({ label, value, onChange, step = "1" }: { label: string; value: number; step?: string; onChange: (value: number) => void }) {
  return <label className="settings-row settings-number"><span>{label}</span><input type="number" step={step} value={value} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next) }} /></label>
}

function formatLatency(value: number | null): string { return value == null ? "—" : `${(value / 1000).toFixed(1)}s` }
