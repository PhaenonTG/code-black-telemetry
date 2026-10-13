import { useState } from "react"
import { Link } from "react-router-dom"
import { useCoreOps } from "../core/useCoreOps"
import { ChaseRadarPanel } from "../workspaces/ChaseRadarPanel"
import { ChaseIntelRail, ChaseOfficialBanner, useChaseIntel } from "../workspaces/ChaseIntelRail"
import OpsWorkstation from "./OpsWorkstation"
import "./Workspaces.css"

const UNIT_KEY = "codeblack.ops.chase.unit.v1"
function savedUnit() { try { return localStorage.getItem(UNIT_KEY) ?? "" } catch { return "" } }
function position(location: Record<string, unknown> | null | undefined) {
  if (!location) return null
  const lat = Number(location.lat ?? location.latitude)
  const lon = Number(location.lon ?? location.lng ?? location.longitude)
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

export default function ChaseWorkspace() {
  const { config, state, selectedPoint } = useCoreOps()
  const [unitId, setUnitId] = useState(savedUnit)
  const units = state.fabric.units?.units ?? []
  const active = units.find((unit) => unit.unit_id === unitId) ?? units.find((unit) => unit.overall_health !== "OFFLINE") ?? units[0]
  const unitPosition = position(active?.location)
  // A selected field unit is the radar reference; a manually chosen map point
  // is only the fallback when that unit has no reported position.
  const radarFocus = unitPosition ?? selectedPoint
  const intel = useChaseIntel(config, radarFocus)
  const chooseUnit = (id: string) => { setUnitId(id); try { localStorage.setItem(UNIT_KEY, id) } catch { /* Choice remains for this session. */ } }
  return <main className="chase-workspace">
    <header className="workspace-heading"><div><h1>Chase</h1><p>Field position, official alerts, and radar context</p></div><nav aria-label="Chase tools"><Link to="/radar">Radar Lab ↗</Link><Link to="/chase">Team & devices ↗</Link></nav></header>
    <div className="chase-unit-strip" aria-label="Selected field unit"><label><span>FIELD UNIT</span><select aria-label="Field unit" value={active?.unit_id ?? ""} onChange={(event) => chooseUnit(event.target.value)}>{units.length === 0 && <option value="">No unit reported</option>}{units.map((unit) => <option key={unit.unit_id} value={unit.unit_id}>{unit.operator_name || unit.display_name}</option>)}</select></label><div><span>POSITION</span><strong>{unitPosition ? `${unitPosition.lat.toFixed(3)}, ${unitPosition.lon.toFixed(3)}` : "Not reporting"}</strong></div><div><span>FABRIC</span><strong>{active?.overall_health ?? state.fabric.state}</strong></div><div><span>LAST REPORT</span><strong>{active?.last_seen ? new Date(typeof active.last_seen === "number" && active.last_seen < 100_000_000_000 ? active.last_seen * 1000 : active.last_seen).toLocaleTimeString() : "Unavailable"}</strong></div></div>
    <ChaseOfficialBanner intel={intel} point={radarFocus} vehiclePosition={Boolean(unitPosition)} />
    <div className="chase-workspace__split"><div className="chase-map-frame"><OpsWorkstation focus="CHASE SITUATION" /></div><ChaseRadarPanel focus={radarFocus} /><ChaseIntelRail intel={intel} point={radarFocus} vehiclePosition={Boolean(unitPosition)} /></div>
    <p className="workspace-note chase-workspace__note">Official point alerts are authoritative for the reference point. Nearby polygon distance is approximate; road feeds may be incomplete. Aegis candidates are internal and unconfirmed.</p>
  </main>
}
