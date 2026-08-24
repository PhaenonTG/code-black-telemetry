import { NavLink } from "react-router-dom"
import { Icon } from "../components/Icon"
import { ROUTES, MORE_ROUTE } from "../app/routes"

const PHONE_ROUTES = [...ROUTES.filter((r) => r.inPhoneNav), MORE_ROUTE]

// Exactly Home / Map / Weather / Alerts / More -- this order and set is a locked product
// decision, not something to casually extend even though the sidebar has more destinations.
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
