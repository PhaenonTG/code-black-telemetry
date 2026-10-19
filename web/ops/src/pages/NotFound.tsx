import { useState } from "react"
import { PageHeader } from "../components/PageHeader"
import { navDetail } from "../layouts/phoneRoutes"
import { ROUTES, routeMatchesQuery } from "../app/routes"
import { Link, useLocation, useNavigate } from "react-router-dom"
import "./NotFound.css"

// Client-side "page not found" view for unknown authenticated OPS paths. It replaces the earlier
// silent redirect to Home so a mistyped or retired link is visible. This is presentation only:
// the HTTP status returned by Pages/Worker routing is unchanged (still the SPA fallback).
export default function NotFound() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  return (
    <div className="page page-not-found ops-not-found">
      <section className="ops-not-found__card" aria-label="Page not found">
        <PageHeader routePath="*" title="" />
        <p className="ops-not-found__body">
          There is no OPS page at <code>{pathname}</code>. The link may be mistyped or retired.
        </p>
        <p className="ops-not-found__hint">Your session is unchanged. Choose a destination below.</p>
        <label className="ops-page-search">Search pages<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {query && <div className="ops-page-search__results">{ROUTES.filter(route => route.inSidebar && routeMatchesQuery(route, query, navDetail(route))).map(route => <Link to={route.path} key={route.path}>{route.label} →</Link>)}</div>}
        <div className="ops-not-found__actions">
          <Link to="/" className="ops-not-found__primary">Open Ops Map</Link>
          <Link to="/status/health">Status</Link>
          <Link to="/directory">Directory</Link>
          <button type="button" onClick={() => navigate(-1)}>Go back</button>
        </div>
      </section>
    </div>
  )
}
