import { useEffect, useState } from "react"
import { loadAppTheme, saveAppTheme, subscribeAppTheme, type AppThemeMode } from "../../../../src/services/settings"
import { loadMapLayerVisibility, saveMapLayerVisibility, subscribeMapLayerVisibility, type MapLayerVisibility } from "../../../../src/services/settings"
import { PageHeader } from "../components/PageHeader"
import { Icon } from "../components/Icon"
import { useAuth } from "../auth/AuthProvider"

const THEME_OPTIONS: AppThemeMode[] = ["dark", "night", "system", "light"]

// MapLayerVisibility's keys are internal identifiers (src/services/settings.ts), not copy --
// this is the one place they get a human-readable name and a one-line description of what
// toggling them actually does, instead of surfacing the raw camelCase key to the user.
const LAYER_LABELS: Record<string, { label: string; description: string }> = {
  alerts: { label: "Weather alerts", description: "NWS warning and watch polygons on the map" },
  team: { label: "Team positions", description: "Live location of other Code Black team members" },
  chasers: { label: "Spotter network", description: "Nearby public storm spotter positions" },
  poi: { label: "Points of interest", description: "Named landmarks and reference points" },
  mosaic: { label: "Wide-area mosaic", description: "Regional composite radar reflectivity" },
  radar: { label: "Single-site radar", description: "High-resolution radar from the nearest site" },
  roadConditions: { label: "Road conditions", description: "DOT-reported closures and hazards" },
  trafficCameras: { label: "Traffic cameras", description: "Public DOT traffic camera feeds" },
  probes: { label: "Probe deployments", description: "Deployed instrument probe locations" },
  chaserNet: { label: "Chaser Net reports", description: "Community-submitted ground truth reports" },
  breadcrumbs: { label: "GPS trail", description: "Your own recent movement history on the map" },
}

// A working foundation, not the full settings surface -- reuses the real settings.ts load/save/
// subscribe layer (same @capacitor/preferences-backed storage the native app uses, with the web
// fallback confirmed safe in docs/ARCHITECTURE.md) for two representative settings groups. Map,
// Road Conditions, Cameras, Notifications, etc. are documented as follow-up work, not faked here.
export default function Settings() {
  const auth = useAuth()
  const [theme, setTheme] = useState<AppThemeMode>("dark")
  const [layers, setLayers] = useState<MapLayerVisibility | null>(null)

  useEffect(() => {
    const unsub = subscribeAppTheme(setTheme)
    void loadAppTheme()
    return unsub
  }, [])
  useEffect(() => {
    const unsub = subscribeMapLayerVisibility(setLayers)
    void loadMapLayerVisibility()
    return unsub
  }, [])

  return (
    <div className="page page-settings">
      <PageHeader title="Settings" />

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

      <section className="settings-group">
        <h2>Map layers</h2>
        {layers ? (
          <div className="settings-toggle-list">
            {Object.entries(layers).map(([key, value]) => {
              const copy = LAYER_LABELS[key] ?? { label: key, description: "" }
              return (
                <label key={key} className="settings-toggle-row">
                  <span className="settings-toggle-row__text">
                    <span className="settings-toggle-row__label">{copy.label}</span>
                    {copy.description && <span className="settings-toggle-row__description">{copy.description}</span>}
                  </span>
                  <span className={value ? "switch switch--on" : "switch"}>
                    <input
                      type="checkbox"
                      checked={!!value}
                      onChange={(e) => void saveMapLayerVisibility({ ...layers, [key]: e.target.checked })}
                    />
                    <i />
                  </span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="page-empty">Loading…</p>
        )}
      </section>

      <section className="settings-group settings-group--deferred">
        <h2>Coming to this shell</h2>
        <p>Road Conditions, Cameras, Location behavior, Notifications, Data/providers, and Native/device integrations exist in the native app's Settings page but aren't rebuilt here yet.</p>
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
