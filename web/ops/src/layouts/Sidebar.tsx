import { NavLink } from "react-router-dom"
import { Icon } from "../components/Icon"
import { ROUTES } from "../app/routes"
import codeblackShield from "../../../../src/assets/codeblack-shield.png"

// Full labeled sidebar on desktop, icon-only rail on tablet (still all 7 destinations -- tablet
// has room for a rail even though it doesn't have room for full labels). Desktop can also
// collapse itself into that same rail on request (AppShell persists the choice), reclaiming
// screen width for the map/panels without losing any destination -- tablet's rail is a viewport
// constraint, not a user choice, so it has no toggle.
export function Sidebar({ rail, collapsible, onToggleCollapse }: { rail: boolean; collapsible?: boolean; onToggleCollapse?: () => void }) {
  return (
    <nav className={rail ? "sidebar sidebar--rail" : "sidebar"} aria-label="Primary">
      <div className="sidebar__brand">
        <img className="sidebar__brand-mark" src={codeblackShield} alt="Code Black" />
        {!rail && <span className="sidebar__brand-text">CODE BLACK<b>OPS</b></span>}
      </div>
      <div className="sidebar__links">
        {ROUTES.filter((r) => r.inSidebar).map((r) => (
          <NavLink key={r.path} to={r.path} className={({ isActive }) => `sidebar__link${isActive ? " active" : ""}`} end={r.path === "/"}>
            <Icon name={r.icon} />
            {!rail && <span>{r.label}</span>}
            {!rail && r.state === "DEVELOPMENT" && <small>DEV</small>}
          </NavLink>
        ))}
      </div>
      {collapsible && (
        <button
          type="button"
          className="sidebar__collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
          title={rail ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name={rail ? "chevron-right" : "chevron-left"} />
        </button>
      )}
    </nav>
  )
}
