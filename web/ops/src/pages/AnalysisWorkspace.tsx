import { lazy, Suspense, useState } from "react"
import { PageHeader } from "../components/PageHeader"
import { Link, useLocation, useNavigate } from "react-router-dom"
import ChaseSetups from "./ChaseSetups"
import ChaseSurveillance from "./ChaseSurveillance"
import "./Workspaces.css"

const TornadoPotential = lazy(() => import("./TornadoPotential"))
const HorizonCatalog = lazy(() => import("../workspaces/setupHorizons/HorizonCatalog"))
type Mode = "outlooks" | "drafts" | "briefings" | "surveillance" | "potential"
const MODE_KEY = "codeblack.ops.analysis.mode.v1"
function savedMode(): Mode {
  try {
    const value = localStorage.getItem(MODE_KEY)
    if (value === "outlooks" || value === "drafts" || value === "briefings" || value === "surveillance" || value === "potential") return value
    return "outlooks"
  } catch { return "outlooks" }
}

export default function AnalysisWorkspace() {
  const [savedSelection, setSavedSelection] = useState<Mode>(savedMode)
  const location = useLocation()
  const navigate = useNavigate()
  const routeMode: Mode | null = location.pathname.startsWith("/analysis/horizons") ? "outlooks" : location.pathname.startsWith("/analysis/potential") ? "potential"
    : location.pathname.startsWith("/analysis/briefings") ? "briefings"
    : location.pathname.startsWith("/analysis/drafts") || location.pathname.startsWith("/analysis/setup/") ? "drafts"
    : null
  const mode = routeMode ?? savedSelection
  const chooseMode = (next: Mode) => {
    setSavedSelection(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* Session selection remains usable. */ }
    navigate(next === "surveillance" ? "/analysis" : next === "outlooks" ? "/analysis/horizons" : `/analysis/${next}`)
  }
  const subtitle = mode === "outlooks" ? "Official outlook timeline and separate speculative context" : mode === "potential" ? "Code Black model-driven tornado potential" : mode === "drafts" ? "Pre-chase setup review" : mode === "briefings" ? "Approved setup briefings" : "Active radar surveillance"
  const context = mode === "outlooks" ? "Saved official sources; unknown and unavailable windows remain explicit" : mode === "drafts" ? "Private drafts · operator review required"
    : mode === "briefings" ? "Approved revisions · private briefing record"
    : mode === "potential" ? "Independent forecast-grid screening · experimental"
    : "Official warnings first · Aegis findings are internal"
  return <section className="analysis-workspace">
    <PageHeader className="workspace-heading" kicker="ANALYSIS · SETUP REVIEW" title="Setup Review" description={subtitle} actions={<div className="analysis-mode" role="group" aria-label="Analysis mode"><button type="button" aria-pressed={mode === "outlooks"} onClick={() => chooseMode("outlooks")}>Outlook timeline</button><button type="button" aria-pressed={mode === "potential"} onClick={() => chooseMode("potential")}>Tornado potential</button><button type="button" aria-pressed={mode === "drafts"} onClick={() => chooseMode("drafts")}>Drafts</button><button type="button" aria-pressed={mode === "briefings"} onClick={() => chooseMode("briefings")}>Reviewed briefings</button><button type="button" aria-pressed={mode === "surveillance"} onClick={() => chooseMode("surveillance")}>Surveillance</button></div>} />
    <div className="analysis-context"><span>{context}</span><nav aria-label="Analysis tools"><Link to="/weather">Weather analysis →</Link><Link to="/radar">Radar Lab →</Link></nav></div>
    {mode === "outlooks" ? <Suspense fallback={<p>Loading outlook timeline.</p>}><HorizonCatalog /></Suspense> : mode === "potential" ? <Suspense fallback={<p>Loading tornado potential…</p>}><TornadoPotential /></Suspense>
      : mode === "drafts" ? <ChaseSetups queue="drafts" detailBasePath="/analysis/drafts" />
      : mode === "briefings" ? <ChaseSetups queue="briefings" detailBasePath="/analysis/briefings" />
      : <ChaseSurveillance />}
  </section>
}
