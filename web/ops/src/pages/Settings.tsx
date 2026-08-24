import { useEffect, useState } from "react"
import { loadAppTheme, saveAppTheme, subscribeAppTheme, type AppThemeMode } from "../../../../src/services/settings"
import { loadMapLayerVisibility, saveMapLayerVisibility, subscribeMapLayerVisibility, type MapLayerVisibility } from "../../../../src/services/settings"
import { PageHeader } from "../components/PageHeader"
import { Icon } from "../components/Icon"
import { useAuth } from "../auth/AuthProvider"

const THEME_OPTIONS: AppThemeMode[] = ["dark", "night", "system", "light"]

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
          Object.entries(layers).map(([key, value]) => (
            <label key={key} className="settings-row settings-row--toggle">
              <span>{key}</span>
              <input
                type="checkbox"
                checked={!!value}
                onChange={(e) => void saveMapLayerVisibility({ ...layers, [key]: e.target.checked })}
              />
            </label>
          ))
        ) : (
          <p className="page-empty">Loading…</p>
        )}
      </section>

      <section className="settings-group settings-group--deferred">
        <h2>Coming to this shell</h2>
        <p>Road Conditions, Cameras, Location behavior, Notifications, Data/providers, and Native/device integrations exist in the native app's Settings page and are documented for follow-up extraction in docs/ARCHITECTURE.md -- not rebuilt here yet.</p>
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
