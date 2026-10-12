import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { useCoreOps } from "../core/useCoreOps"
import { useDesk } from "../desk/DeskProvider"
import { ageLabel } from "../desk/format"
import { radarEvidenceStatus } from "../desk/radarEvidence"
import codeblackShield from "../../../../src/assets/codeblack-shield.png"

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer) }, [])
  return <div className="desk-clock"><time dateTime={now.toISOString()}>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" })}</time><span>{now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {now.toISOString().slice(11, 16)}Z</span></div>
}

export function StatusBar() {
  const { state } = useCoreOps()
  const { gps, observation, alerts, alertsError, errors, now } = useDesk()
  const { pathname } = useLocation()
  const workspace = pathname === "/producer" ? "Producer" : pathname === "/chase" ? "Chase" : pathname === "/analysis" ? "Analysis" : "Ops"
  const radar = radarEvidenceStatus(observation?.radar, !!errors.Observation, now)
  const items = [
    { label: "Core", state: state.core.state === "LIVE" ? "ok" : state.core.state === "CHECKING" ? "checking" : "off", detail: state.core.detail },
    { label: "Radar", state: radar, detail: observation?.radar.updated_at ? `Radar evidence ${ageLabel(observation.radar.updated_at, now)}${radar === "warn" ? " · Review needed" : ""}` : "Radar evidence unavailable" },
    { label: "GPS", state: gps.status === "ready" ? "ok" : gps.status === "requesting" ? "checking" : "off", detail: gps.status === "ready" ? `Device GPS ±${Math.round(gps.accuracyM)} m` : `Device location ${gps.status}` },
    { label: "Alerts", state: alertsError ? "warn" : alerts.length ? "alert" : "off", detail: alertsError || `${alerts.length} active official products at the current reference` },
  ]
  return <header className="desk-header">
    <a className="desk-skip" href="#ops-main">Skip to workspace</a>
    <Link to="/producer" className="desk-header__brand"><img src={codeblackShield} alt="" /><span>CODE <b>BLACK</b> <em>OPS</em></span></Link>
    <span className="desk-header__workspace">{workspace}</span>
    <div className="desk-health" aria-label="Source health">{items.map((item) => <Link to="/system" key={item.label} className="desk-health__item" title={item.detail} aria-label={`${item.label}: ${item.detail}`}><i data-state={item.state} /><span>{item.label}</span></Link>)}</div>
    <Link className="desk-health-mobile" to="/system" aria-label="Open source health"><i data-state={state.core.state === "LIVE" ? "ok" : "off"} />Sources</Link>
    <Clock />
  </header>
}
