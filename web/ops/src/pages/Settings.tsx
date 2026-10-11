import { useEffect, useState } from "react"
import { loadAppTheme, saveAppTheme, subscribeAppTheme, type AppThemeMode } from "../../../../src/services/settings"
import { loadMapLayerVisibility, saveMapLayerVisibility, subscribeMapLayerVisibility, type MapLayerVisibility } from "../../../../src/services/settings"
import { PageHeader } from "../components/PageHeader"
import { Icon } from "../components/Icon"
import { useAuth } from "../auth/AuthProvider"
import { Link } from "react-router-dom"
import { loadWeatherAlertSettings, saveWeatherAlertSettings, type WeatherAlertSettings } from "../weatherAlertSettings"

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
  const [theme, setTheme] = useState<AppThemeMode>("dark")
  const [layers, setLayers] = useState<MapLayerVisibility | null>(null)
  const [alertSettings, setAlertSettings] = useState<WeatherAlertSettings | null>(null)
  const [alertError, setAlertError] = useState<string | null>(null)
  const [alertSaving, setAlertSaving] = useState(false)

  useEffect(() => {
    const unsub = subscribeAppTheme(setTheme)
    void loadAppTheme()
    return unsub
  }, [])
  useEffect(() => {
    void loadWeatherAlertSettings().then(setAlertSettings).catch(() => setAlertError("Weather alert controls are unavailable."))
  }, [])

  const saveAlerts = async () => {
    if (!alertSettings) return
    setAlertSaving(true); setAlertError(null)
    try { setAlertSettings(await saveWeatherAlertSettings(alertSettings)) }
    catch { setAlertError("Could not save weather alert controls. No change was confirmed.") }
    finally { setAlertSaving(false) }
  }
  useEffect(() => {
    const unsub = subscribeMapLayerVisibility(setLayers)
    void loadMapLayerVisibility()
    return unsub
  }, [])

  return (
    <div className="page page-settings">
      <PageHeader title="SETTINGS" kicker="DISPLAY · MAP · SESSION" description="Set this browser's operating defaults. Changes apply immediately and persist on this device." actions={<Link className="page-action-link" to="/system">SYSTEM HEALTH</Link>} />

      <section className="settings-group">
        <h2>Display</h2>
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

      <section className="settings-group settings-group--layers">
        <h2>Map layer defaults</h2>
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

      <section className="settings-group settings-group--data">
        <h2>Data & diagnostics</h2>
        <p>Provider health, radar availability, camera totals, and Core connectivity are tracked on the System page.</p>
        <Link className="page-action-link" to="/system">VIEW PROVIDER STATUS</Link>
      </section>

      <section className="settings-group settings-group--alerts">
        <h2>Weather alert controls</h2>
        <p className="settings-alert-copy">These settings control Discord alert intake and routing. Changes apply to the live alert pipeline after saving.</p>
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
          {alertError && <p className="page-empty">{alertError}</p>}
          <button type="button" className="page-action-link settings-save" disabled={alertSaving} onClick={() => void saveAlerts()}>{alertSaving ? "SAVING…" : "SAVE WEATHER ALERT CONTROLS"}</button>
        </> : <p className="page-empty">{alertError ?? "Loading…"}</p>}
      </section>

      {auth.status === "authorized" && (
        <section className="settings-group">
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
