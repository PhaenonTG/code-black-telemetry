import { NavLink } from "react-router-dom"
import { Icon } from "../components/Icon"
import { ROUTES, MORE_ROUTE } from "../app/routes"

const PHONE_ROUTES = [...ROUTES.filter((r) => r.inPhoneNav), MORE_ROUTE]

// Exactly Live Ops / Radar / Storm Intel / Fleet / More -- this order and set is a locked
// product decision, not something to casually extend even though the sidebar has more
// destinations. (A "Home / Map / Weather / Alerts / More" set was planned at one point --
// Home.tsx existed fully built but was never routed to anything, and /map, /weather, /alerts
// exist in app/App.tsx as unreferenced aliases of OpsWorkstation. This comment used to describe
// that older plan instead of what ROUTES/inPhoneNav below actually produces.)
export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {PHONE_ROUTES.map((r) => (
        <NavLink key={r.path} to={r.path} className={({ isActive }) => `bottom-nav__link${isActive ? " active" : ""}`} end={r.path === "/"}>
          <Icon name={r.icon} />
          <span>{r.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
