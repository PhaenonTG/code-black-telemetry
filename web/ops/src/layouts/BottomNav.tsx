import { NavLink } from "react-router-dom"
import { Icon } from "../components/Icon"
const PHONE_ROUTES = [
  { path: "/", label: "HOME", icon: "home" as const },
  { path: "/radar", label: "RADAR", icon: "radar" as const },
  { path: "/system", label: "OPS", icon: "system" as const },
  { path: "/ai", label: "AEGIS", icon: "ops" as const },
  { path: "/more", label: "MORE", icon: "more" as const },
]

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
