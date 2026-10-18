import type { CSSProperties } from "react"
import { Link } from "react-router-dom"
import { Icon } from "../components/Icon"
import { PageHeader } from "../components/PageHeader"
import { MORE_SECTIONS, navDetail, navLabel } from "../layouts/phoneRoutes"

// Page-scoped brand styling (no More CSS file is in the allowed list); motion only under
// prefers-reduced-motion: no-preference, transform/opacity only.
const MORE_BRAND_CSS = `
.shell .page-more--brand .page-header h1{font-family:Anton,Inter,ui-sans-serif,system-ui,sans-serif;font-weight:400;letter-spacing:.04em}
.shell .page-more--brand .ops-more-section h2{display:flex;align-items:center;gap:10px;color:var(--cb-gray);letter-spacing:.16em}
.shell .page-more--brand .ops-more-section h2::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(255,42,12,.8),transparent);box-shadow:0 0 6px rgba(255,42,12,.5)}
.shell .page-more--brand .ops-more-grid__item{position:relative;overflow:hidden;margin-bottom:8px;border:1px solid var(--cb-line);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,0) 50%),repeating-linear-gradient(90deg,rgba(255,255,255,.012) 0 1px,transparent 1px 3px),var(--cb-panel-hi);padding:14px 14px}
.shell .page-more--brand .ops-more-grid__item::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:2px;border-radius:2px;background:var(--cb-red);box-shadow:0 0 8px rgba(255,42,12,.8);opacity:.85}
.shell .page-more--brand .ops-more-grid__item::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 35%,rgba(255,255,255,.07) 50%,transparent 65%);transform:translateX(-120%);pointer-events:none}
.shell .page-more--brand .ops-more-grid__item>svg:first-child{color:var(--cb-red)}
.shell .page-more--brand .ops-more-grid__item:hover,.shell .page-more--brand .ops-more-grid__item:focus-visible{border-color:rgba(255,42,12,.45);box-shadow:0 0 14px -6px rgba(255,42,12,.8)}
.shell .page-more--brand .ops-more-grid__item:focus-visible{outline:2px solid var(--cb-red);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){
.shell .page-more--brand .ops-more-grid__item{animation:cb-more-in 340ms cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--cb-i,0) * 35ms);transition:border-color 180ms,box-shadow 220ms,transform 180ms cubic-bezier(.2,.8,.2,1)}
.shell .page-more--brand .ops-more-grid__item::after{transition:transform 460ms cubic-bezier(.2,.8,.2,1)}
.shell .page-more--brand .ops-more-grid__item:hover::after{transform:translateX(120%)}
.shell .page-more--brand .ops-more-grid__item:active{transform:scale(.985)}
@keyframes cb-more-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
}
`

// Phone-only landing page for routes that don't deserve a bottom-nav slot. Desktop/tablet reach
// these directly from the sidebar, so this page itself only renders inside the phone shell.
// Sections and labels mirror the desktop sidebar (see layouts/phoneRoutes.ts) so both trees match.
export default function More() {
  return (
    <div className="page page-more page-more--brand">
      <style href="cb-brand-more" precedence="default">{MORE_BRAND_CSS}</style>
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
