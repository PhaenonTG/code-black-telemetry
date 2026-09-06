import { useEffect, useState } from "react"
import codeblackShield from "../../../../src/assets/codeblack-shield.png"
import { useCoreOps } from "../core/useCoreOps"
import { OpsStatusPill } from "../components/OpsStatusPill"

// Compact top strip for desktop/tablet -- not a duplicate of the Operations page, just the
// handful of things worth glancing at without navigating away from whatever workspace is open.
export function StatusBar({ locationLabel }: { locationLabel: string }) {
  const [now, setNow] = useState(() => new Date())
  const { state, config } = useCoreOps(null)
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="statusbar">
      <div className="statusbar__brand">
        <img src={codeblackShield} alt="Code Black WX" />
        <span>CODE BLACK OPS</span>
      </div>
      <OpsStatusPill state={state.core.state} label={`CORE ${state.core.state}`} />
      <OpsStatusPill state={state.fabric.wsState === "open" ? "LIVE" : state.fabric.state} label={`FABRIC ${state.fabric.wsState.toUpperCase()}`} />
      <div className="statusbar__item">{locationLabel}</div>
      <div className="statusbar__item">MODE {config.mode}</div>
      <div className="statusbar__spacer" />
      <div className="statusbar__item">UTC {now.toISOString().slice(11, 19)}</div>
      <div className="statusbar__item statusbar__clock">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </div>
    </div>
  )
}
