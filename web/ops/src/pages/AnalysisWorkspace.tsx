import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Icon } from "../components/Icon"
import { PageHeader } from "../components/PageHeader"
import { AsyncViewState } from "../components/AsyncViewState"
import { Link, useLocation } from "react-router-dom"
import { SETUP_TABS, type SetupTab } from "../workspaces/chaseDay/setupReview/SetupReviewModel"
import { useViewport } from "../hooks/useViewport"
import ChaseSetups from "./ChaseSetups"
import ChaseSurveillance from "./ChaseSurveillance"
import "./Workspaces.css"

const TornadoPotential = lazy(() => import("./TornadoPotential"))
const HorizonCatalog = lazy(() => import("../workspaces/setupHorizons/HorizonCatalog"))
const ChaseDayBriefingCard = lazy(() => import("../workspaces/chaseDay/ChaseDayBriefingCard"))
const names: Record<SetupTab, string> = { today: "Today", outlook: "Outlook", potential: "Potential", drafts: "Drafts", briefings: "Briefings", surveillance: "Surveillance" }

export default function AnalysisWorkspace() {
  const location = useLocation()
  const viewport = useViewport()
  const requested = location.pathname.split("/")[2] as SetupTab
  const mode = SETUP_TABS.includes(requested) ? requested : "outlook"
  const [visited, setVisited] = useState<SetupTab[]>([mode])
  // Retain visited panels and their results for this workspace visit; never persist a landing preference.
  if (!visited.includes(mode)) setVisited([...visited, mode])
  const tabs = useRef<HTMLElement>(null)
  useEffect(() => {
    document.title = `${names[mode]} · Setup Review · Code Black OPS`
    tabs.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" })
  }, [mode])
  const related = mode === "outlook" || mode === "potential" ? <><Link to="/weather">Weather Analysis →</Link><Link to="/soundings">Soundings →</Link></>
    : mode === "surveillance" ? <><Link to="/radar">Radar Lab →</Link><Link to="/aegis-alerts">Aegis Alerts →</Link></> : null
  return <section className="analysis-workspace">
    <PageHeader className="workspace-heading" routePath="/setup-review" title="Setup Review" description="Forecast setups from outlook to briefing" actions={related && <details className="analysis-related" open={viewport !== "phone"}><summary aria-label="Related tools"><Icon name="more" /><span className="analysis-related-label">Related tools</span></summary><nav aria-label="Related tools">{related}</nav></details>} />
    <nav ref={tabs} className="analysis-mode" aria-label="Setup Review tabs">{SETUP_TABS.map(tab => <Link key={tab} to={`/setup-review/${tab}`} aria-current={mode === tab ? "page" : undefined}>{names[tab]}</Link>)}</nav>
    {visited.map(tab => <div key={tab} className="analysis-tab-panel" data-tab={tab} hidden={mode !== tab}>
      <Suspense fallback={<AsyncViewState compact state="loading" title={`Opening ${names[tab]}`} />}>
        {tab === "today" ? <ChaseDayBriefingCard /> : tab === "outlook" ? <HorizonCatalog /> : tab === "potential" ? <TornadoPotential />
          : tab === "drafts" || tab === "briefings" ? <ChaseSetups queue={tab} active={mode === tab} detailBasePath={`/setup-review/${tab}`} /> : <ChaseSurveillance />}
      </Suspense>
    </div>)}
  </section>
}
