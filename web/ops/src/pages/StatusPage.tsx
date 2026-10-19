import { Link, useLocation } from "react-router-dom"
import Operations from "./Operations"
import StatusCenter from "./StatusCenter"

// Telemetry remains intact, including its role gates, policy form and inventory.
export default function StatusPage() {
  const telemetry = useLocation().pathname === "/status/telemetry"
  return <div className="status-page">
    <nav className="section-tabs" aria-label="Status tabs">
      <Link to="/status/health" className={!telemetry ? "active" : undefined} aria-current={!telemetry ? "page" : undefined}>Health</Link>
      <Link to="/status/telemetry" className={telemetry ? "active" : undefined} aria-current={telemetry ? "page" : undefined}>Telemetry</Link>
    </nav>
    {telemetry ? <StatusCenter /> : <Operations />}
  </div>
}
