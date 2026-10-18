import { Link, useLocation, useNavigate } from "react-router-dom"
import "./NotFound.css"

// Client-side "page not found" view for unknown authenticated OPS paths. It replaces the earlier
// silent redirect to Home so a mistyped or retired link is visible. This is presentation only:
// the HTTP status returned by Pages/Worker routing is unchanged (still the SPA fallback).
export default function NotFound() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <div className="page page-not-found ops-not-found">
      <section className="ops-not-found__card" aria-labelledby="ops-not-found-title">
        <p className="ops-not-found__kicker">ROUTE NOT FOUND</p>
        <h1 id="ops-not-found-title" className="ops-not-found__title">
          <span className="ops-not-found__code">404</span> · Page not found
        </h1>
        <p className="ops-not-found__body">
          There is no OPS page at <code>{pathname}</code>. The link may be mistyped or retired.
        </p>
        <p className="ops-not-found__hint">Your session is unchanged. Choose a destination below.</p>
        <div className="ops-not-found__actions">
          <Link to="/" className="ops-not-found__primary">GO TO HOME</Link>
          <Link to="/status-center">STATUS CENTER</Link>
          <Link to="/directory">SITE DIRECTORY</Link>
          <button type="button" onClick={() => navigate(-1)}>GO BACK</button>
        </div>
      </section>
    </div>
  )
}
