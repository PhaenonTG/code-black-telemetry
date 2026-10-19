import { formatOpsTimestamp } from "../core/timeFormat"
import { EmptyState } from "../components/AsyncViewState"
import { PageHeader } from "../components/PageHeader"
import { OpsStatusPill } from "../components/OpsStatusPill"
import { useSharedOpsStatus, statusAge } from "../core/useSharedOpsStatus"
import type { OpsConnectionState } from "../core/types"
import type { FabricPresenceState } from "../../../../src/services/fabric/types"
import { ageText } from "../../../../src/services/radar"
import { Link } from "react-router-dom"
import { useEffect, useState } from "react"
import { liveChaserReadings } from "./strikerReadings"

// FabricPresenceState has one member OpsConnectionState doesn't (NOT_CONFIGURED) -- map it to
// the closest existing pill tone rather than casting past the type system.
function pillState(health: FabricPresenceState): OpsConnectionState {
  return health === "NOT_CONFIGURED" ? "UNAVAILABLE" : health
}

export function lastSeenLabel(lastSeen: number | string | null): string {
  // TODO(stale-threshold): retain current Team last-report behavior pending policy review.
  if (lastSeen == null) return "Never reported"
  const timestamp = typeof lastSeen === "string"
    ? Date.parse(lastSeen)
    : lastSeen < 100_000_000_000 ? lastSeen * 1000 : lastSeen
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Last seen unavailable"
  if (Date.now() - timestamp >= 3_600_000) return `Last seen ${formatOpsTimestamp(timestamp)}`
  return `Last seen ${ageText(Math.max(0, Math.round((Date.now() - timestamp) / 1000)))} ago`
}

export default function Fleet() {
  const { fabric, now: statusNow } = useSharedOpsStatus()
  const snapshot = fabric.units
  const units = snapshot?.units ?? []
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div className="page page-fleet">
      <PageHeader routePath="/team" title="" description="Active chase units, their onboard devices, and when each last reported." />
      <p><Link to="/producer/sources">Producer › Sources →</Link></p>
      {fabric.state === "STALE" && <p role="status">Stale Fabric snapshot · {statusAge(fabric.unitsReceivedAt ?? fabric.lastContactAt ?? fabric.checkedAt, statusNow)}</p>}
      {units.length === 0 ? (
        <EmptyState title={snapshot ? "No units registered" : "No Fabric unit snapshot"} message={snapshot ? "Fabric is reachable, but no units are registered yet." : `${fabric.detail}. Units appear here when Fabric supplies a snapshot.`}>
          <div className="empty-state__actions"><Link to="/">Open Ops Map →</Link><Link to="/status/health">Open Status →</Link></div>
        </EmptyState>
      ) : (
        <div className="ops-team-table-wrap"><table className="ops-team-table"><thead><tr><th>Chaser</th><th>Role</th><th>Device</th><th>Last report</th><th>Status</th></tr></thead><tbody>
          {units.map((unit) => {
            const readings = liveChaserReadings(unit, now)
            return (
            <tr key={unit.unit_id}><td><strong>{unit.operator_name || unit.display_name}</strong></td><td>{unit.role}</td><td>{unit.display_name}<small>{unit.unit_id}</small>{(unit.devices ?? []).map(device => <small key={device.device_id}>{device.display_label}</small>)}</td><td>{lastSeenLabel(unit.last_seen)}
              {readings.length > 0 && (
                <div className="ops-fleet-card__readings" aria-label={`${unit.operator_name || unit.display_name} live conditions`}>
                  <div className="ops-fleet-card__readings-heading"><strong>Live conditions</strong><span>{`${Math.ceil(Math.max(...readings.map((reading) => reading.ageMs)) / 1000)}s ago`}</span></div>
                  <dl>{readings.map((reading) => (
                    <div key={reading.key}><dt>{reading.label}</dt><dd>{reading.value}</dd></div>
                  ))}</dl>
                </div>
              )}
            </td><td><OpsStatusPill state={pillState(unit.overall_health)} label={unit.overall_health} /></td></tr>
          )})}
        </tbody></table></div>
      )}
    </div>
  )
}
