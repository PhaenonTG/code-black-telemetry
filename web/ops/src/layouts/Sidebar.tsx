import { useEffect, useRef, type CSSProperties } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { Icon } from "../components/Icon"
import { ROUTES } from "../app/routes"
import { NAV_SECTIONS, NAV_SECTION_LABELS, navLabel } from "./phoneRoutes"
import codeblackShield from "../../../../src/assets/codeblack-shield.png"
import "./Sidebar.css"

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
  // Short viewports (e.g. 1024x594) scroll the link list. Never scroll on initial load, so the
  // top (Workspaces) section stays in view; on later route/rail changes, scroll the list itself
  // (not the page) by the minimum amount, and only when the active link is outside its visible area.
  const lastNav = useRef<string | null>(null)
  useEffect(() => {
    const key = `${pathname}|${rail}`
    const previous = lastNav.current
    lastNav.current = key
    // First render (and StrictMode's repeated mount effect for the same key) never scrolls.
    if (previous === null || previous === key) return
    const container = linksRef.current
    const active = container?.querySelector<HTMLElement>(".sidebar__link.active")
    if (!container || !active) return
    const box = container.getBoundingClientRect()
    const link = active.getBoundingClientRect()
    if (link.top >= box.top && link.bottom <= box.bottom) return
    container.scrollTop += link.top < box.top ? link.top - box.top : link.bottom - box.bottom
  }, [pathname, rail])
  return (
    <nav className={rail ? "sidebar sidebar--rail sidebar--brand" : "sidebar sidebar--brand"} aria-label="Primary">
      <div className="sidebar__brand">
        <img className="sidebar__brand-mark" src={codeblackShield} alt="Code Black" />
        {!rail && <span className="sidebar__brand-text">CODE BLACK<b>OPS</b></span>}
      </div>
      {/* Sections never shrink inside the scrolling list, so the first (Workspaces) items can't be
          squeezed out of view at short heights; the list itself scrolls instead. */}
      <div className="sidebar__links" ref={linksRef} style={{ minHeight: 0, flex: "1 1 auto", overflowY: "auto" }}>
        {sections.map((section, index) => (
          <section className="sidebar__section" key={section.name} aria-label={section.label} style={{ flexShrink: 0, "--cb-i": index } as CSSProperties}>
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
