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
  const sections = (["ANALYSIS", "FIELD", "SYSTEM"] as const).map((name) => ({
    name,
    routes: ROUTES.filter((route) => route.inSidebar && route.section === name),
  }))
  return (
    <nav className={rail ? "sidebar sidebar--rail" : "sidebar"} aria-label="Primary">
      <div className="sidebar__brand">
        <img className="sidebar__brand-mark" src={codeblackShield} alt="Code Black" />
        {!rail && <span className="sidebar__brand-text">CODE BLACK<b>OPS</b></span>}
      </div>
      <div className="sidebar__links">
        {sections.map((section) => (
          <section className="sidebar__section" key={section.name} aria-label={section.name}>
            {!rail && <p className="sidebar__section-label">{section.name}</p>}
            {section.routes.map((r) => (
              <NavLink key={r.path} to={r.path} title={rail ? r.label : undefined} aria-label={r.label} className={({ isActive }) => `sidebar__link${isActive ? " active" : ""}`} end={r.path === "/"}>
                <Icon name={r.icon} />
                {!rail && <span>{r.label}</span>}
              </NavLink>
            ))}
          </section>
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
