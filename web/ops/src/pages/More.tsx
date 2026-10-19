import { useState } from "react"
import { Link } from "react-router-dom"
import { Icon } from "../components/Icon"
import { PageHeader } from "../components/PageHeader"
import { ROUTES } from "../app/routes"
import { MORE_SECTIONS, navDetail, navLabel } from "../layouts/phoneRoutes"
import "./More.css"

export default function More() {
  const [query, setQuery] = useState("")
  return <div className="page page-more page-more--brand">
    <PageHeader routePath="/more" title="" description="Find maps, forecasts, team status, and tools." />
    <label className="ops-page-search">Search pages<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search pages" /></label>
    {query && <div className="ops-page-search__results">{ROUTES.filter(route => route.inSidebar && `${route.label} ${route.path} ${navDetail(route) ?? ""}`.toLowerCase().includes(query.toLowerCase())).map(route => <Link key={route.path} to={route.path}>{route.label} →</Link>)}</div>}
    <div className="ops-more-grid">
      {MORE_SECTIONS.map(group => {
        const links = group.routes.map(route => <Link key={route.path} to={route.path} className="ops-more-grid__item">
          <Icon name={route.icon} /><span className="ops-more-copy"><span>{navLabel(route)}{route.state === "DEVELOPMENT" && <small className="sidebar__dev"> DEV</small>}</span>{navDetail(route) && <small>{navDetail(route)}</small>}</span><Icon name="chevron" className="ops-more-grid__chevron" />
        </Link>)
        return group.section === "LABS" ? <details className="ops-more-section" key={group.section}><summary>{group.label}</summary>{links}</details> : <section className="ops-more-section" key={group.section} aria-label={group.label}><h2>{group.label}</h2>{links}</section>
      })}
    </div>
  </div>
}
