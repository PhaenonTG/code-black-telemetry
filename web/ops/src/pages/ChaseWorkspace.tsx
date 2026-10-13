import { Link } from "react-router-dom"
import { useCoreOps } from "../core/useCoreOps"
import { ChaseRadarPanel } from "../workspaces/ChaseRadarPanel"
import { ChaseIntelRail, ChaseOfficialBanner, useChaseIntel } from "../workspaces/ChaseIntelRail"
import OpsWorkstation from "./OpsWorkstation"
import "./Workspaces.css"
import { liveChaserFix } from "../core/referenceLocation"

export default function ChaseWorkspace() {
  const { config, state, selectedPoint, locationMode, referenceUnitId, referenceLabel, referenceIsFallback } = useCoreOps()
  const units = state.fabric.units?.units ?? []
  const active = locationMode === "chaser" ? units.find((unit) => unit.unit_id === referenceUnitId) : undefined
  const radarFocus = selectedPoint
  const vehiclePosition = locationMode === "chaser" && !referenceIsFallback
  const lastFix = active ? liveChaserFix(active)?.observedAt : null
  const intel = useChaseIntel(config, radarFocus)
  return <main className="chase-workspace">
    <header className="workspace-heading"><div><h1>Chase</h1><p>Field position, official alerts, and radar context</p></div><nav aria-label="Chase tools"><Link to="/radar">Radar Lab ↗</Link><Link to="/chase">Team & devices ↗</Link></nav></header>
    <div className="chase-unit-strip" aria-label="Active location reference"><div><span>LOCATION REFERENCE</span><strong>{referenceLabel}</strong></div><div><span>POSITION</span><strong>{selectedPoint ? `${selectedPoint.lat.toFixed(3)}, ${selectedPoint.lon.toFixed(3)}` : "Unavailable"}</strong></div><div><span>FABRIC</span><strong>{active?.overall_health ?? state.fabric.state}</strong></div><div><span>LAST CHASER GPS FIX</span><strong>{lastFix ? new Date(lastFix).toLocaleTimeString() : "Unavailable"}</strong></div></div>
    <ChaseOfficialBanner intel={intel} point={radarFocus} vehiclePosition={vehiclePosition} />
    <div className="chase-workspace__split"><div className="chase-map-frame"><OpsWorkstation focus="CHASE SITUATION" /></div><ChaseRadarPanel focus={radarFocus} /><ChaseIntelRail intel={intel} point={radarFocus} vehiclePosition={vehiclePosition} /></div>
    <p className="workspace-note chase-workspace__note">Official point alerts are authoritative for the reference point. Nearby polygon distance is approximate; road feeds may be incomplete. Aegis candidates are internal and unconfirmed.</p>
  </main>
}
