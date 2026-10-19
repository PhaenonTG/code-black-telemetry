import { useEffect, useState } from "react"
import { useSharedOpsStatus, statusAge } from "../core/useSharedOpsStatus"
import { OpsStatusPill } from "../components/OpsStatusPill"
import type { OpsConnectionState } from "../core/types"
import { LocationControl } from "./LocationControl"

// Compact top strip for desktop/tablet -- not a duplicate of the Operations page, just the
// handful of things worth glancing at without navigating away from whatever workspace is open.
// No brand mark here -- the sidebar already shows the Code Black OPS logo/wordmark on every one
// of these viewports, so a second copy here was pure duplication, not a second piece of info.
export function StatusBar() {
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
      <OpsStatusPill state={core.state} label={`CORE ${core.state}${core.state === "STALE" ? ` ${statusAge(core.checkedAt, statusNow)}` : ""}`} />
      <OpsStatusPill state={wsTone} label={`FABRIC FEED ${fabric.state === "STALE" ? `STALE ${statusAge(fabric.unitsReceivedAt ?? fabric.lastContactAt ?? fabric.checkedAt, statusNow)}` : fabric.streamState.toUpperCase()}`} />
      <div className="statusbar__spacer" />
      <LocationControl />
      <div className="statusbar__item">UTC {now.toISOString().slice(11, 19)}</div>
      <div className="statusbar__item statusbar__clock">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
    </div>
  )
}
