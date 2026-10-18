import type { CSSProperties } from "react"
import { Link } from "react-router-dom"
import { Icon } from "../components/Icon"
import { PageHeader } from "../components/PageHeader"
import { MORE_SECTIONS, navDetail, navLabel } from "../layouts/phoneRoutes"
import "./More.css"

// Phone-only landing page for routes that don't deserve a bottom-nav slot. Desktop/tablet reach
// these directly from the sidebar, so this page itself only renders inside the phone shell.
// Sections and labels mirror the desktop sidebar (see layouts/phoneRoutes.ts) so both trees match.
export default function More() {
  return (
    <div className="page page-more page-more--brand">
      <PageHeader title="More" description="Workspaces, maps and analysis, field operations, and admin tools." />
      <div className="ops-more-grid">
        {MORE_SECTIONS.map((group, groupIndex) => (
          <section className="ops-more-section" key={group.section} aria-label={group.label}>
            <h2>{group.label}</h2>
            {group.routes.map((r, index) => {
              const detail = navDetail(r)
              return (
                <Link key={r.path} to={r.path} className="ops-more-grid__item" style={{ "--cb-i": groupIndex * 3 + index } as CSSProperties}>
                  <Icon name={r.icon} />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span>{navLabel(r)}</span>
                    {detail && <small style={{ color: "var(--cb-muted)", fontSize: 12, fontWeight: 500, letterSpacing: 0, textTransform: "none" }}>{detail}</small>}
                  </span>
                  <Icon name="chevron" className="ops-more-grid__chevron" />
                </Link>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}
