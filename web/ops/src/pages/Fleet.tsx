import { PageHeader } from "../components/PageHeader"
import { OpsStatusPill } from "../components/OpsStatusPill"
import { useCoreOps } from "../core/useCoreOps"
import type { OpsConnectionState } from "../core/types"
import type { FabricPresenceState } from "../../../../src/services/fabric/types"
import { ageText } from "../../../../src/services/radar"
import { Link } from "react-router-dom"
import { useEffect, useState } from "react"
import { displayedStrikerReading, formatStrikerReading, STRIKER_SENSORS, strikerDevice, strikerReading, strikerReadingAge, strikerReportAge, type LastValidStrikerReading } from "./strikerReadings"

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
  const [lastValid, setLastValid] = useState<Record<string, LastValidStrikerReading>>({})
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const checkedAt = Date.now()
    const updates: Record<string, LastValidStrikerReading> = {}
    for (const sensor of STRIKER_SENSORS) {
      const device = strikerDevice(snapshot, sensor.id)
      for (const field of sensor.fields) {
        const value = strikerReading(device, field.key, checkedAt)
        const age = strikerReadingAge(device, field.key, checkedAt)
        if (value !== null && age !== null) updates[`${sensor.id}:${field.key}`] = { value, observedAt: checkedAt - age }
      }
    }
    if (Object.keys(updates).length > 0) setLastValid((previous) => ({ ...previous, ...updates }))
  }, [snapshot])

  return (
    <div className="page page-fleet">
      <PageHeader title="CHASE OPERATIONS" kicker="FLEET · STREAMS · ACTIVE UNITS" description="Track active chase units, onboard systems, and the live program feed." />
      <nav className="section-tabs" aria-label="Chase Operations sections">
        <Link className="active" to="/chase">FLEET</Link>
        <Link to="/stream">STREAMS</Link>
      </nav>
      <section className="striker-readings" aria-label="Striker ESP live readings">
        <div className="striker-readings__heading"><div><p>STRIKER · CORE MESONET</p><h2>ESP readings</h2></div><span>Reading age is shown · unavailable sensors show —</span></div>
        <div className="striker-readings__grid">
          {STRIKER_SENSORS.map((sensor) => {
            const device = strikerDevice(snapshot, sensor.id)
            const reportAge = strikerReportAge(device, now)
            const live = reportAge !== null && reportAge <= 15_000 && device?.connected !== false
            return <article className="striker-readings__card" key={sensor.id}>
              <header><h3>{sensor.title}</h3><strong className={live ? "is-live" : ""}>{live ? "REPORTING" : "NO FRESH REPORT"}</strong></header>
              <p>{reportAge === null ? "No Core report" : `Core report ${Math.ceil(reportAge / 1000)}s ago`}</p>
              <dl>{sensor.fields.map((field) => {
                const reading = displayedStrikerReading(device, field.key, now, lastValid[`${sensor.id}:${field.key}`])
                return <div key={field.key}><dt>{field.label}</dt><dd className={reading?.source === "last_valid" ? "is-last-valid" : ""}>{formatStrikerReading(field.key, reading?.value ?? null)}<small>{reading === null ? "Unavailable" : reading.source === "last_valid" ? `Last valid ${Math.ceil(reading.ageMs / 1000)}s ago` : `${Math.ceil(reading.ageMs / 1000)}s old`}</small></dd></div>
              })}</dl>
            </article>
          })}
        </div>
        <p className="striker-readings__note">Recent readings remain visible during uplink delays. If a sensor stops reporting, its last valid value is labeled and held for up to one minute. Core source values are displayed in °F, mph, and inHg where applicable. Wind pulses remain raw Hz.</p>
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
