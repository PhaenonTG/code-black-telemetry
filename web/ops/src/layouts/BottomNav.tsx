import { NavLink } from "react-router-dom"
import { Icon } from "../components/Icon"
import { PHONE_ROUTES } from "./phoneRoutes"

// Phone navigation is deliberately separate from the desktop sidebar.  Five
// destinations preserve a one-handed layout; deeper weather/field controls live
// under Home actions and More instead of becoming a sixth or seventh tiny tab.
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
