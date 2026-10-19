import { Link, useLocation } from "react-router-dom"
import { Icon } from "../components/Icon"
import { PHONE_ROUTES, activePhoneRoute } from "./phoneRoutes"

// Phone navigation is deliberately separate from the desktop sidebar.  Five
// destinations preserve a one-handed layout; deeper weather/field controls live
// under Home actions and More instead of becoming a sixth or seventh tiny tab.
export function BottomNav() {
  const { pathname } = useLocation()
  const activePath = activePhoneRoute(pathname)
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {PHONE_ROUTES.map((r) => (
        <Link key={r.path} to={r.path} className={`bottom-nav__link${activePath === r.path ? " active" : ""}`} aria-current={activePath === r.path ? "page" : undefined}>
          <Icon name={r.icon} />
          <span>{r.label}</span>
        </Link>
      ))}
    </nav>
  )
}
