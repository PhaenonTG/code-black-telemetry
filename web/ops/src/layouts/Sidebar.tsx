import { NavLink } from "react-router-dom"
import { Icon } from "../components/Icon"
import { ROUTES } from "../app/routes"

// Full labeled sidebar on desktop, icon-only rail on tablet (still all 7 destinations -- tablet
// has room for a rail even though it doesn't have room for full labels).
export function Sidebar({ rail }: { rail: boolean }) {
  return (
    <nav className={rail ? "sidebar sidebar--rail" : "sidebar"} aria-label="Primary">
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark">CB</span>
        {!rail && <span className="sidebar__brand-text">CODE BLACK<b>OPS</b></span>}
      </div>
      <div className="sidebar__links">
        {ROUTES.map((r) => (
          <NavLink key={r.path} to={r.path} className={({ isActive }) => `sidebar__link${isActive ? " active" : ""}`} end={r.path === "/"}>
            <Icon name={r.icon} />
            {!rail && <span>{r.label}</span>}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
