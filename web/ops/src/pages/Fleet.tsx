import { PageHeader } from "../components/PageHeader"
import { OpsStatusPill } from "../components/OpsStatusPill"
import { useCoreOps } from "../core/useCoreOps"
import type { OpsConnectionState } from "../core/types"
import type { FabricPresenceState } from "../../../../src/services/fabric/types"
import { ageText } from "../../../../src/services/radar"
import { Link } from "react-router-dom"
import { useEffect, useState } from "react"
import { STRIKER_SENSORS, strikerDevice, strikerReading, strikerReportAge } from "./strikerReadings"

// FabricPresenceState has one member OpsConnectionState doesn't (NOT_CONFIGURED) -- map it to
// the closest existing pill tone rather than casting past the type system.
function pillState(health: FabricPresenceState): OpsConnectionState {
  return health === "NOT_CONFIGURED" ? "UNAVAILABLE" : health
}

export function lastSeenLabel(lastSeen: number | string | null): string {
  if (lastSeen == null) return "Never reported"
  const timestamp = typeof lastSeen === "string"
    ? Date.parse(lastSeen)
    : lastSeen < 100_000_000_000 ? lastSeen * 1000 : lastSeen
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Last seen unavailable"
  return `Last seen ${ageText(Math.max(0, Math.round((Date.now() - timestamp) / 1000)))} ago`
}

export default function Fleet() {
  const { state } = useCoreOps()
  const snapshot = state.fabric.units
  const units = snapshot?.units ?? []
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="page page-fleet">
      <PageHeader title="CHASE OPERATIONS" kicker="FLEET · STREAMS · ACTIVE UNITS" description="Track active chase units, onboard systems, and the live program feed." />
      <nav className="section-tabs" aria-label="Chase Operations sections">
        <Link className="active" to="/chase">FLEET</Link>
        <Link to="/stream">STREAMS</Link>
      </nav>
      <section className="striker-readings" aria-label="Striker ESP live readings">
        <div className="striker-readings__heading"><div><p>STRIKER · CORE MESONET</p><h2>ESP readings</h2></div><span>Live values expire after 3 seconds · unavailable sensors show —</span></div>
        <div className="striker-readings__grid">
          {STRIKER_SENSORS.map((sensor) => {
            const device = strikerDevice(snapshot, sensor.id)
            const reportAge = strikerReportAge(device, now)
            const live = reportAge !== null && reportAge <= 5_000 && device?.connected !== false
            return <article className="striker-readings__card" key={sensor.id}>
              <header><h3>{sensor.title}</h3><strong className={live ? "is-live" : ""}>{live ? "REPORTING" : "NO FRESH REPORT"}</strong></header>
              <p>{reportAge === null ? "No Core report" : `Core report ${Math.ceil(reportAge / 1000)}s ago`}</p>
              <dl>{sensor.fields.map((field) => {
                const value = strikerReading(device, field.key, now)
                return <div key={field.key}><dt>{field.label}</dt><dd>{value === null ? "—" : `${value.toFixed(field.key === "latitude" || field.key === "longitude" ? 5 : 1)}${field.unit}`}</dd></div>
              })}</dl>
            </article>
          })}
        </div>
        <p className="striker-readings__note">Values come from each board’s accepted Core report. Reporting does not confirm sensor calibration or wiring.</p>
      </section>
      {units.length === 0 ? (
        <div className="empty-state empty-state--centered">
          <p className="empty-state__title">{snapshot ? "NO UNITS REGISTERED" : "NO FABRIC UNIT SNAPSHOT"}</p>
          <p className="empty-state__body">
            {snapshot ? "Fabric is reachable, but no units are registered yet." : `${state.fabric.detail}. Units appear here when Fabric supplies a snapshot.`}
          </p>
          <div className="empty-state__actions"><Link to="/">OPEN OPERATIONS MAP</Link><Link to="/system">VIEW SYSTEM HEALTH</Link></div>
        </div>
      ) : (
        <div className="ops-fleet-grid">
          {units.map((unit) => (
            <section className="ops-fleet-card" key={unit.unit_id}>
              <header>
                <p>{unit.role}</p>
                <OpsStatusPill state={pillState(unit.overall_health)} label={unit.overall_health} />
              </header>
              <h2>{unit.operator_name || unit.display_name}</h2>
              <span className="ops-fleet-card__meta">{lastSeenLabel(unit.last_seen)}</span>
              {unit.devices.length > 0 && (
                <ul className="ops-fleet-card__devices">
                  {unit.devices.map((device) => (
                    <li key={device.device_id}>
                      <i className={device.connected ? "is-connected" : ""} />
                      {device.display_label}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
