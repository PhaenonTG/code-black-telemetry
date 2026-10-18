import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "../auth/AuthProvider"
import { configuredRadarSites } from "../../../../shared/radarSitePolicy.mjs"
import { PrivateRadarPilot } from "../radarR3/RadarR3Pilot"
const OpsWorkstation = lazy(() => import("./OpsWorkstation"))
const SITE_KEY = "codeblack.radar.siteOverride"
const sites = configuredRadarSites(import.meta.env.VITE_PRIVATE_RADAR_SITES)

export default function RadarLab() {
  const auth = useAuth()
  const current = auth.status === "authorized" ? auth.session : null
  const session = useMemo(() => current?.expires_at ? {
    userId: current.user.id, accessToken: current.access_token, expiresAtMs: current.expires_at * 1000,
  } : null, [current?.user.id, current?.access_token, current?.expires_at])
  const [site, setSite] = useState(() => {
    try { return localStorage.getItem(SITE_KEY) ?? "" } catch { return "" }
  })
  const [showTools, setShowTools] = useState(false)
  useEffect(() => {
    const changed = () => { try { setSite(localStorage.getItem(SITE_KEY) ?? "") } catch { /* preference unchanged */ } }
    window.addEventListener("storage", changed)
    window.addEventListener("codeblack:radar-site-changed", changed)
    return () => { window.removeEventListener("storage", changed); window.removeEventListener("codeblack:radar-site-changed", changed) }
  }, [])
  const onFrame = useCallback(() => {}, [])
  const allowed = sites.includes(site)
  return <section aria-label="Radar Lab">
    <h1>Radar Lab</h1>
    <label>Single-site radar <select value={site} onChange={event => {
      const next = event.target.value
      setSite(next)
      try { if (next) localStorage.setItem(SITE_KEY, next); else localStorage.removeItem(SITE_KEY); window.dispatchEvent(new Event("codeblack:radar-site-changed")) } catch { /* session preference remains */ }
    }}>
      <option value="">Select site</option>
      {site && !allowed && <option value={site}>{site} — unavailable in this deployment</option>}
      {sites.map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
    {!sites.length ? <p role="status">Single-site routing is not configured.</p> : !allowed ? <p role="status">Choose an available site. The saved site has not been replaced.</p> :
      <PrivateRadarPilot key={site} site={site} active session={session} onFrame={onFrame} />}
    <details onToggle={event => setShowTools(event.currentTarget.open)}><summary>Situation map and existing Radar Lab tools</summary>
      {showTools && <Suspense fallback={<p>Loading situation map…</p>}><OpsWorkstation focus="RADAR LAB" /></Suspense>}
    </details>
  </section>
}
