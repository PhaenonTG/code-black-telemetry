import { PageHeader } from "../components/PageHeader"
import { OpsStatusPill } from "../components/OpsStatusPill"
import { useCoreOps } from "../core/useCoreOps"
import type { OpsConnectionState } from "../core/types"
import type { FabricPresenceState } from "../../../../src/services/fabric/types"
import { ageText } from "../../../../src/services/radar"
import { Link } from "react-router-dom"

// FabricPresenceState has one member OpsConnectionState doesn't (NOT_CONFIGURED) -- map it to
// the closest existing pill tone rather than casting past the type system.
function pillState(health: FabricPresenceState): OpsConnectionState {
  return health === "NOT_CONFIGURED" ? "UNAVAILABLE" : health
}

function lastSeenLabel(lastSeen: number | null): string {
  if (lastSeen == null) return "Never reported"
  return `Last seen ${ageText(Math.max(0, Math.round((Date.now() - lastSeen) / 1000)))} ago`
}

export default function Fleet() {
  const { state } = useCoreOps()
  const snapshot = state.fabric.units
  const units = snapshot?.units ?? []

  return (
    <div className="page page-fleet">
      <PageHeader title="CHASE OPERATIONS" kicker="FLEET · STREAMS · ACTIVE UNITS" description="Track active chase units, onboard systems, and the live program feed." />
      <nav className="section-tabs" aria-label="Chase Operations sections">
        <Link className="active" to="/chase">FLEET</Link>
        <Link to="/stream">STREAMS</Link>
      </nav>
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
