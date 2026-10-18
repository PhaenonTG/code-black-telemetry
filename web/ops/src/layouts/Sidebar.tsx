import { useEffect, useRef } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { Icon } from "../components/Icon"
import { ROUTES } from "../app/routes"
import { NAV_SECTIONS, NAV_SECTION_LABELS, navLabel } from "./phoneRoutes"
import codeblackShield from "../../../../src/assets/codeblack-shield.png"

// Full labeled sidebar on desktop, icon-only rail on tablet (still all 7 destinations -- tablet
// has room for a rail even though it doesn't have room for full labels). Desktop can also
// collapse itself into that same rail on request (AppShell persists the choice), reclaiming
// screen width for the map/panels without losing any destination -- tablet's rail is a viewport
// constraint, not a user choice, so it has no toggle.
export function Sidebar({ rail, collapsible, onToggleCollapse }: { rail: boolean; collapsible?: boolean; onToggleCollapse?: () => void }) {
  const { pathname } = useLocation()
  const linksRef = useRef<HTMLDivElement>(null)
  const sections = NAV_SECTIONS.map((name) => ({
    name,
    label: NAV_SECTION_LABELS[name],
    routes: ROUTES.filter((route) => route.inSidebar && route.section === name),
  }))
  // Short viewports (e.g. 1024x594) scroll the link list. Keep the active destination visible
  // without jumping: "nearest" only scrolls when the active link is actually out of view.
  useEffect(() => {
    const active = linksRef.current?.querySelector<HTMLElement>(".sidebar__link.active")
    if (active && typeof active.scrollIntoView === "function") active.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [pathname, rail])
  return (
    <nav className={rail ? "sidebar sidebar--rail" : "sidebar"} aria-label="Primary">
      <div className="sidebar__brand">
        <img className="sidebar__brand-mark" src={codeblackShield} alt="Code Black" />
        {!rail && <span className="sidebar__brand-text">CODE BLACK<b>OPS</b></span>}
      </div>
      {/* Sections never shrink inside the scrolling list, so the first (Workspaces) items can't be
          squeezed out of view at short heights; the list itself scrolls instead. */}
      <div className="sidebar__links" ref={linksRef} style={{ minHeight: 0, flex: "1 1 auto", overflowY: "auto" }}>
        {sections.map((section) => (
          <section className="sidebar__section" key={section.name} aria-label={section.label} style={{ flexShrink: 0 }}>
            {!rail && <p className="sidebar__section-label">{section.label.toUpperCase()}</p>}
            {section.routes.map((r) => {
              const label = navLabel(r)
              return (
                <NavLink key={r.path} to={r.path} title={rail ? label : undefined} aria-label={label} className={({ isActive }) => `sidebar__link${isActive ? " active" : ""}`} end={r.path === "/"}>
                  <Icon name={r.icon} />
                  {!rail && <span>{label}</span>}
                </NavLink>
              )
            })}
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
