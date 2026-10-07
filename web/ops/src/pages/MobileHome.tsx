import { lazy, Suspense } from "react"
import { Link } from "react-router-dom"
import { Icon } from "../components/Icon"
import { useCoreOps } from "../core/useCoreOps"
import { useViewport } from "../hooks/useViewport"
const OpsWorkstation = lazy(() => import("./OpsWorkstation"))

const PRIMARY_ACTIONS = [
  { to: "/field", icon: "map" as const, title: "Map", detail: "Live operating picture" },
  { to: "/radar", icon: "radar" as const, title: "Radar", detail: "Frames and analysis" },
  { to: "/weather", icon: "cloud" as const, title: "Weather", detail: "Storm intelligence" },
  { to: "/chase", icon: "fleet" as const, title: "Chasers", detail: "Field readiness" },
]

export default function MobileHome() {
  const viewport = useViewport()
  const { state, selectPoint } = useCoreOps()

  // Desktop keeps the map-first workstation it was designed for.  The phone gets
  // an intentionally different command surface rather than a compressed map rail.
  if (viewport !== "phone") return <Suspense fallback={<div className="page-empty" role="status">Loading map…</div>}><OpsWorkstation focus="OPERATIONS MAP" /></Suspense>

  const online = state.core.state === "LIVE"
  return (
    <div className="mobile-home mobile-home--compact">
      <header className="mobile-home__header">
        <div className="mobile-home__brand">
          <span className="mobile-home__mark"><Icon name="ops" /></span>
          <span>CODE BLACK <b>OPS</b></span>
        </div>
        <Link to="/system" className="mobile-home__header-link" aria-label="Open system status"><Icon name="system" /></Link>
      </header>

      <Link to="/system" className="mobile-home__readiness" data-state={state.core.state} aria-label={`System: Core ${state.core.state.toLowerCase()}`}>
          <span className={online ? "mobile-home__signal mobile-home__signal--live" : "mobile-home__signal"} />
          <strong>Core {online ? "online" : state.core.state.toLowerCase()}</strong>
          <span className="mobile-home__status-link">System <Icon name="chevron" /></span>
      </Link>

      <section className="mobile-home__actions" aria-label="Primary operations">
        {PRIMARY_ACTIONS.map((action) => (
          <Link key={action.to} to={action.to} className="mobile-action">
            <Icon name={action.icon} />
            <span><b>{action.title}</b><small>{action.detail}</small></span>
            <Icon name="chevron" className="mobile-action__chevron" />
          </Link>
        ))}
      </section>

      <Link to="/ai" className="mobile-action mobile-action--aegis"><Icon name="ops" /><span><b>Aegis</b><small>Open console</small></span><Icon name="chevron" className="mobile-action__chevron" /></Link>

      <section className="mobile-home__watch" aria-label="Watch locations">
        <div className="mobile-home__section-title"><span>Watch locations</span><Link to="/weather">Weather</Link></div>
        <Link to="/weather" onClick={() => selectPoint({ lat: 36.45, lon: -94.12 })} className="mobile-home__location"><Icon name="gps" /><span><b>Pea Ridge, AR</b><small>Spencer / Silas base</small></span><Icon name="chevron" /></Link>
        <Link to="/weather" onClick={() => selectPoint({ lat: 39.05, lon: -95.68 })} className="mobile-home__location"><Icon name="gps" /><span><b>Topeka, KS</b><small>Nick base</small></span><Icon name="chevron" /></Link>
      </section>
    </div>
  )
}
