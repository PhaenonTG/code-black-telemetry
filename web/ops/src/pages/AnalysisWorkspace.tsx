import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import ChaseSetups from "./ChaseSetups"
import AegisAlerts from "./AegisAlerts"
import "./Workspaces.css"

type Mode = "drafts" | "briefings" | "surveillance"
const MODE_KEY = "codeblack.ops.analysis.mode.v1"
function savedMode(): Mode {
  try {
    const value = localStorage.getItem(MODE_KEY)
    if (value === "briefings" || value === "surveillance") return value
    return "drafts"
  } catch { return "drafts" }
}

export default function AnalysisWorkspace() {
  const [savedSelection, setSavedSelection] = useState<Mode>(savedMode)
  const location = useLocation()
  const navigate = useNavigate()
  const routeMode: Mode | null = location.pathname.startsWith("/analysis/briefings") ? "briefings"
    : location.pathname.startsWith("/analysis/drafts") || location.pathname.startsWith("/analysis/setup/") ? "drafts"
    : null
  const mode = routeMode ?? savedSelection
  const chooseMode = (next: Mode) => {
    setSavedSelection(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* Session selection remains usable. */ }
    navigate(next === "surveillance" ? "/analysis" : `/analysis/${next}`)
  }
  const subtitle = mode === "drafts" ? "Pre-chase setup review" : mode === "briefings" ? "Approved setup briefings" : "Active radar surveillance"
  const context = mode === "drafts" ? "Private drafts · operator review required"
    : mode === "briefings" ? "Approved revisions · private briefing record"
    : "Official warnings first · Aegis findings are internal"
  return <main className="analysis-workspace">
    <header className="workspace-heading"><div><h1>Analysis</h1><p>{subtitle}</p></div><div className="analysis-mode" role="group" aria-label="Analysis mode"><button type="button" aria-pressed={mode === "drafts"} onClick={() => chooseMode("drafts")}>Drafts</button><button type="button" aria-pressed={mode === "briefings"} onClick={() => chooseMode("briefings")}>Reviewed briefings</button><button type="button" aria-pressed={mode === "surveillance"} onClick={() => chooseMode("surveillance")}>Surveillance</button></div></header>
    <div className="analysis-context"><span>{context}</span><nav aria-label="Analysis tools"><Link to="/weather">Weather analysis ↗</Link><Link to="/radar">Radar Lab ↗</Link></nav></div>
    {mode === "drafts" ? <ChaseSetups embedded queue="drafts" detailBasePath="/analysis/drafts" />
      : mode === "briefings" ? <ChaseSetups embedded queue="briefings" detailBasePath="/analysis/briefings" />
      : <AegisAlerts embedded />}
  </main>
}
