import { Link } from "react-router-dom"
import { Icon } from "../components/Icon"
import { OpsStatusPill } from "../components/OpsStatusPill"
import { useCoreOps } from "../core/useCoreOps"
import { useViewport } from "../hooks/useViewport"
import OpsWorkstation from "./OpsWorkstation"

const PRIMARY_ACTIONS = [
  { to: "/field", icon: "map" as const, title: "Map", detail: "Live operating picture" },
  { to: "/radar", icon: "radar" as const, title: "Radar", detail: "Frames and analysis" },
  { to: "/weather", icon: "cloud" as const, title: "Weather", detail: "Storm intelligence" },
  { to: "/chase", icon: "fleet" as const, title: "Chasers", detail: "Field readiness" },
]

export default function MobileHome() {
  const viewport = useViewport()
  const { state } = useCoreOps()

  // Desktop keeps the map-first workstation it was designed for.  The phone gets
  // an intentionally different command surface rather than a compressed map rail.
  if (viewport !== "phone") return <OpsWorkstation focus="OPERATIONS MAP" />

  const online = state.core.state === "LIVE"
  return (
    <div className="mobile-home">
      <header className="mobile-home__header">
        <div className="mobile-home__brand">
          <span className="mobile-home__mark"><Icon name="ops" /></span>
          <span>CODE BLACK <b>OPS</b></span>
        </div>
        <Link to="/system" className="mobile-home__header-link" aria-label="Open system status"><Icon name="system" /></Link>
      </header>

      <section className="mobile-home__readiness" aria-label="Operations readiness">
        <div className="mobile-home__readiness-head">
          <span className={online ? "mobile-home__signal mobile-home__signal--live" : "mobile-home__signal"} />
          <strong>{online ? "OPS READY" : "OPS CHECKING"}</strong>
          <OpsStatusPill state={state.core.state} label="CORE" />
        </div>
        <h1>Operations</h1>
        <p>{state.stormIntel.detail || "Live status and decision tools for the field."}</p>
        <Link to="/system" className="mobile-home__manage">Manage <Icon name="chevron" /></Link>
      </section>

      <section className="mobile-home__actions" aria-label="Primary operations">
        {PRIMARY_ACTIONS.map((action) => (
          <Link key={action.to} to={action.to} className="mobile-action">
            <Icon name={action.icon} />
            <span><b>{action.title}</b><small>{action.detail}</small></span>
            <Icon name="chevron" className="mobile-action__chevron" />
          </Link>
        ))}
      </section>

      <section className="mobile-home__aegis" aria-label="Aegis intelligence">
        <div className="mobile-home__section-title"><span><Icon name="ops" /> Aegis</span><small>AI INTELLIGENCE</small></div>
        <p>Open the factory to view the live assignment, review queue, and knowledge flow.</p>
        <Link to="/ai" className="mobile-home__aegis-open">Open Aegis <Icon name="chevron" /></Link>
      </section>

      <section className="mobile-home__watch" aria-label="Watch locations">
        <div className="mobile-home__section-title"><span><Icon name="gps" /> Watch locations</span><Link to="/weather">Edit</Link></div>
        <Link to="/weather" className="mobile-home__location"><Icon name="gps" /><span><b>Pea Ridge, AR</b><small>Spencer / Silas base</small></span><Icon name="chevron" /></Link>
        <Link to="/weather" className="mobile-home__location"><Icon name="gps" /><span><b>Topeka, KS</b><small>Nick base</small></span><Icon name="chevron" /></Link>
      </section>
    </div>
  )
}
