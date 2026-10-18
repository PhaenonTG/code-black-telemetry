import { useEffect, useRef, type CSSProperties } from "react"
import { NavLink, useLocation } from "react-router-dom"
import { Icon } from "../components/Icon"
import { ROUTES } from "../app/routes"
import { NAV_SECTIONS, NAV_SECTION_LABELS, navLabel } from "./phoneRoutes"
import codeblackShield from "../../../../src/assets/codeblack-shield.png"

// Component-scoped brand styling (held: global theme/tokens). Selectors are all under
// .sidebar--brand; motion only runs under prefers-reduced-motion: no-preference and only animates
// transform/opacity. Uses existing --cb-* variables.
const SIDEBAR_BRAND_CSS = `
.shell .sidebar--brand{position:relative;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0) 22%),repeating-linear-gradient(90deg,rgba(255,255,255,.014) 0 1px,transparent 1px 3px),linear-gradient(160deg,var(--cb-panel-hi),var(--cb-shell) 70%);border-right:1px solid var(--cb-line)}
.shell .sidebar--brand::after{content:"";position:absolute;top:0;right:-1px;bottom:0;width:1px;background:linear-gradient(180deg,transparent,var(--cb-red) 18%,var(--cb-red) 82%,transparent);box-shadow:0 0 8px 0 rgba(255,42,12,.55);opacity:.7;pointer-events:none}
.shell .sidebar--brand .sidebar__brand{border-bottom:1px solid transparent;border-image:linear-gradient(90deg,transparent,rgba(255,42,12,.7),transparent) 1}
.shell .sidebar--brand .sidebar__brand-text{font-family:Anton,Inter,ui-sans-serif,system-ui,sans-serif;font-size:15px;font-weight:400;letter-spacing:.06em}
.shell .sidebar--brand .sidebar__brand-mark{filter:drop-shadow(0 0 6px rgba(255,42,12,.45))}
.shell .sidebar--brand .sidebar__section-label{color:var(--cb-gray);letter-spacing:.18em}
.shell .sidebar--brand .sidebar__section-label::before{content:"";display:inline-block;width:10px;height:1px;margin-right:8px;vertical-align:middle;background:var(--cb-red);box-shadow:0 0 6px rgba(255,42,12,.8)}
.shell .sidebar--brand .sidebar__link{position:relative;overflow:hidden;border-radius:8px;border:1px solid transparent}
.shell .sidebar--brand .sidebar__link::before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.07) 50%,transparent 70%);transform:translateX(-120%);opacity:0;pointer-events:none}
.shell .sidebar--brand .sidebar__link:hover{color:var(--cb-text);background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.01));border-color:var(--cb-line)}
.shell .sidebar--brand .sidebar__link.active{color:var(--cb-text);background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.015)),var(--cb-panel-hi);border-color:rgba(255,42,12,.35);box-shadow:inset 2px 0 0 var(--cb-red),-1px 0 10px -2px rgba(255,42,12,.6),0 0 0 1px rgba(255,42,12,.08)}
.shell .sidebar--brand .sidebar__link.active svg{color:var(--cb-red);filter:drop-shadow(0 0 4px rgba(255,42,12,.7))}
.shell .sidebar--brand .sidebar__link:focus-visible{outline:2px solid var(--cb-red);outline-offset:1px}
.shell .sidebar--brand .sidebar__collapse-toggle{border-radius:8px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0))}
.shell .sidebar--brand .sidebar__collapse-toggle:hover{border-color:rgba(255,42,12,.5);box-shadow:0 0 10px -3px rgba(255,42,12,.7)}
@media (prefers-reduced-motion:no-preference){
.shell .sidebar--brand .sidebar__link{transition:color 180ms cubic-bezier(.2,.8,.2,1),background 180ms cubic-bezier(.2,.8,.2,1),border-color 180ms,box-shadow 220ms}
.shell .sidebar--brand .sidebar__link::before{transition:transform 420ms cubic-bezier(.2,.8,.2,1),opacity 200ms}
.shell .sidebar--brand .sidebar__link:hover::before{transform:translateX(120%);opacity:1}
.shell .sidebar--brand .sidebar__link svg{transition:transform 200ms cubic-bezier(.2,.8,.2,1)}
.shell .sidebar--brand .sidebar__link:hover svg{transform:translateX(2px)}
.shell .sidebar--brand .sidebar__section{animation:cb-sidebar-in 360ms cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--cb-i,0) * 60ms)}
@keyframes cb-sidebar-in{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
}
`

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
      <style href="cb-brand-sidebar" precedence="default">{SIDEBAR_BRAND_CSS}</style>
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
