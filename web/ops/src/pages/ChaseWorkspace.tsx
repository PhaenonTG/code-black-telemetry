import { Link } from "react-router-dom"
import { useCoreOps } from "../core/useCoreOps"
import OpsWorkstation from "./OpsWorkstation"
import "./Workspaces.css"

export default function ChaseWorkspace() {
  const { state } = useCoreOps()
  const units = state.fabric.units?.units ?? []
  const active = units.find((unit) => unit.overall_health !== "OFFLINE") ?? units[0]
  return <main className="chase-workspace">
    <header className="workspace-heading"><div><h1>Chase</h1><p>Field position, official alerts, and radar context</p></div><nav aria-label="Chase tools"><Link to="/radar">Radar Lab ↗</Link><Link to="/chase">Team & devices ↗</Link></nav></header>
    <div className="chase-unit-strip" aria-label="Selected field unit"><div><span>FIELD UNIT</span><strong>{active?.operator_name || active?.display_name || "No unit reported"}</strong></div><div><span>FABRIC</span><strong>{state.fabric.state}</strong></div><div><span>LAST REPORT</span><strong>{active?.last_seen ? new Date(typeof active.last_seen === "number" && active.last_seen < 100_000_000_000 ? active.last_seen * 1000 : active.last_seen).toLocaleTimeString() : "Unavailable"}</strong></div><div><span>RADAR</span><strong>See map controls</strong></div></div>
    <div className="chase-map-frame"><OpsWorkstation focus="CHASE SITUATION" /></div>
    <p className="workspace-note chase-workspace__note">Official alerts in the map rail take precedence over internal Aegis findings. Road cameras are supporting context, not Producer live-stream sources.</p>
  </main>
}
