import { useEffect, useState } from "react"
import { useCoreOps } from "../core/useCoreOps"
import { OpsStatusPill } from "../components/OpsStatusPill"
import type { OpsConnectionState } from "../core/types"

// Compact top strip for desktop/tablet -- not a duplicate of the Operations page, just the
// handful of things worth glancing at without navigating away from whatever workspace is open.
// No brand mark here -- the sidebar already shows the Code Black OPS logo/wordmark on every one
// of these viewports, so a second copy here was pure duplication, not a second piece of info.
export function StatusBar({ locationLabel }: { locationLabel: string }) {
  const [now, setNow] = useState(() => new Date())
  const { state } = useCoreOps()
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  // The label already reads "FABRIC {wsState}" -- the pill next to it needs to be colored by that
  // same wsState, not by a different metric (Fabric REST health) that happens to also be called
  // "fabric". The old `wsState === "open" ? LIVE : state.fabric.state` fallback showed a green
  // LIVE pill next to a "FABRIC DISABLED" label whenever REST was healthy but the WS just wasn't
  // open -- the color and the text were answering two different questions.
  const wsTone: OpsConnectionState = state.fabric.wsState === "open" ? "LIVE"
    : state.fabric.wsState === "connecting" ? "CHECKING"
    : state.fabric.wsState === "error" ? "DEGRADED"
    : state.fabric.wsState === "closed" ? "OFFLINE"
    : "UNAVAILABLE"
  return (
    <div className="statusbar">
      <OpsStatusPill state={state.core.state} label={`CORE ${state.core.state}`} />
      <OpsStatusPill state={wsTone} label={`FABRIC ${state.fabric.wsState.toUpperCase()}`} />
      <div className="statusbar__spacer" />
      <div className="statusbar__item statusbar__location">{locationLabel}</div>
      <div className="statusbar__item">UTC {now.toISOString().slice(11, 19)}</div>
      <div className="statusbar__item statusbar__clock">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
    </div>
  )
}
