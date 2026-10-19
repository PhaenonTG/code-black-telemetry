import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "../auth/AuthProvider"
import { configuredRadarSites } from "../../../../shared/radarSitePolicy.mjs"
import { PrivateRadarPilot } from "../radarR3/RadarR3Pilot"
import { PageHeader } from "../components/PageHeader"
import "./RadarLab.css"
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
  // Presentation only: the select's value is the saved site itself, so a saved KSRX reads "KSRX"
  // rather than the placeholder. The placeholder option exists only when nothing is saved.
  const savedLabel = !site ? "No site saved" : allowed ? `Saved site ${site}` : `Saved site ${site} · unavailable here`
  return <section className="page radar-lab" aria-label="Radar Lab">
    <PageHeader title="RADAR LAB" kicker="SINGLE-SITE RADAR" description="Private single-site radar for the saved site. The site choice is stored on this device and shared with the situation map." />
    <div className="radar-lab__controls">
      <label className="radar-lab__field">
        <span className="radar-lab__field-label">Single-site radar</span>
        <span className="radar-lab__select-wrap">
          <select className="radar-lab__select" value={site} onChange={event => {
            const next = event.target.value
            setSite(next)
            try { if (next) localStorage.setItem(SITE_KEY, next); else localStorage.removeItem(SITE_KEY); window.dispatchEvent(new Event("codeblack:radar-site-changed")) } catch { /* session preference remains */ }
          }}>
            {!site && <option value="">Select site</option>}
            {site && !allowed && <option value={site}>{site} — unavailable in this deployment</option>}
            {sites.map(value => <option key={value} value={value}>{value}</option>)}
            {site && <option value="">Clear saved site</option>}
          </select>
        </span>
      </label>
      <span className={`radar-lab__saved${site && allowed ? " radar-lab__saved--ok" : site ? " radar-lab__saved--warn" : ""}`} aria-live="polite">{savedLabel}</span>
    </div>
    {!sites.length ? <p className="radar-lab__notice" role="status">Single-site routing is not configured.</p> : !allowed ? <p className="radar-lab__notice" role="status">{site ? "Choose an available site. The saved site has not been replaced." : "Choose an available site to start the single-site radar."}</p> :
      <div className="radar-lab__pilot"><PrivateRadarPilot key={site} site={site} active session={session} onFrame={onFrame} /></div>}
    <details className="radar-lab__tools" onToggle={event => setShowTools(event.currentTarget.open)}><summary>Situation map and existing Radar Lab tools</summary>
      {showTools && <Suspense fallback={<p className="radar-lab__notice" role="status">Loading situation map…</p>}><OpsWorkstation focus="RADAR LAB" /></Suspense>}
    </details>
  </section>
}
