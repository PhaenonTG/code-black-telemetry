import { useState } from "react"
import { Link } from "react-router-dom"
import ChaseSetups from "./ChaseSetups"
import AegisAlerts from "./AegisAlerts"
import "./Workspaces.css"

type Mode = "setup" | "surveillance"
const MODE_KEY = "codeblack.ops.analysis.mode.v1"
function savedMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === "surveillance" ? "surveillance" : "setup" } catch { return "setup" }
}

export default function AnalysisWorkspace() {
  const [mode, setMode] = useState<Mode>(savedMode)
  const chooseMode = (next: Mode) => {
    setMode(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* Session selection remains usable. */ }
  }
  return <main className="analysis-workspace">
    <header className="workspace-heading"><div><h1>Analysis</h1><p>{mode === "setup" ? "Pre-chase setup review" : "Active radar surveillance"}</p></div><div className="analysis-mode" role="group" aria-label="Analysis mode"><button type="button" aria-pressed={mode === "setup"} onClick={() => chooseMode("setup")}>Setup</button><button type="button" aria-pressed={mode === "surveillance"} onClick={() => chooseMode("surveillance")}>Surveillance</button></div></header>
    <div className="analysis-context"><span>{mode === "setup" ? "Private setup drafts · operator review required" : "Official warnings first · Aegis findings are internal"}</span><nav aria-label="Analysis tools"><Link to="/weather">Weather analysis ↗</Link><Link to="/radar">Radar Lab ↗</Link></nav></div>
    {mode === "setup" ? <ChaseSetups /> : <AegisAlerts />}
  </main>
}
