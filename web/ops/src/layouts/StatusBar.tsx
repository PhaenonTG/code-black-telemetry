import { useEffect, useState } from "react"
import { useSharedOpsStatus, statusAge } from "../core/useSharedOpsStatus"
import { OpsStatusPill } from "../components/OpsStatusPill"
import type { OpsConnectionState } from "../core/types"
import { Link, useLocation } from "react-router-dom"
import { routeForPath, routeEyebrow } from "../app/routes"
import { formatOpsClock } from "../core/timeFormat"
import { LocationControl } from "./LocationControl"

// Compact top strip for desktop/tablet -- not a duplicate of the Operations page, just the
// handful of things worth glancing at without navigating away from whatever workspace is open.
// No brand mark here -- the sidebar already shows the Code Black OPS logo/wordmark on every one
// of these viewports, so a second copy here was pure duplication, not a second piece of info.
export function StatusBar() {
  const currentRoute = routeForPath(useLocation().pathname)
  const [now, setNow] = useState(() => new Date())
  const { core, fabric, now: statusNow } = useSharedOpsStatus()
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  // This pill reports the Fabric WebSocket only; REST health is reported separately on System.
  const wsTone: OpsConnectionState = fabric.state === "STALE" ? "STALE" : fabric.streamState === "open" ? "LIVE"
    : fabric.streamState === "connecting" ? "CHECKING"
    : fabric.streamState === "error" ? "DEGRADED"
    : fabric.streamState === "closed" ? "OFFLINE"
    : "UNAVAILABLE"
  return (
    <div className="statusbar">
      <Link to="/status/health" aria-label="Open Core health"><OpsStatusPill state={core.state} label={`Core ${core.state}${core.state === "STALE" ? ` ${statusAge(core.checkedAt, statusNow)}` : ""}`} /></Link>
      <Link to="/status/health" aria-label="Open Fabric health"><OpsStatusPill state={wsTone} label={`Fabric ${fabric.state === "STALE" ? `STALE ${statusAge(fabric.unitsReceivedAt ?? fabric.lastContactAt ?? fabric.checkedAt, statusNow)}` : fabric.streamState.toUpperCase()}`} /></Link>
      {currentRoute && <span className="statusbar__route">{routeEyebrow(currentRoute)}</span>}
      <div className="statusbar__spacer" />
      <LocationControl />
      <time className="statusbar__item statusbar__clock" dateTime={now.toISOString()} title={now.toISOString()}>{formatOpsClock(now)}</time>
    </div>
  )
}
