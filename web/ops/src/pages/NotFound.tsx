import { Link, useLocation, useNavigate } from "react-router-dom"

// Client-side "page not found" view for unknown authenticated OPS paths. It replaces the earlier
// silent redirect to Home so a mistyped or retired link is visible. This is presentation only:
// the HTTP status returned by Pages/Worker routing is unchanged (still the SPA fallback).
export default function NotFound() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <div className="page page-not-found">
      <section className="empty-state empty-state--centered" aria-labelledby="ops-not-found-title" style={{ textAlign: "left", maxWidth: 560 }}>
        <p className="page-header__kicker" style={{ color: "var(--cb-amber)" }}>ROUTE NOT FOUND</p>
        <h1 id="ops-not-found-title" style={{ margin: "0 0 12px", fontFamily: "Anton, Inter, ui-sans-serif, system-ui, sans-serif", fontSize: "clamp(28px, 6vw, 40px)", lineHeight: 1.1, letterSpacing: ".02em", textTransform: "uppercase" }}>
          <span style={{ color: "var(--cb-red)" }}>404</span> · Page not found
        </h1>
        <p className="empty-state__body" style={{ fontSize: 14, color: "var(--cb-text)" }}>
          There is no OPS page at <code style={{ overflowWrap: "anywhere", color: "var(--cb-amber)" }}>{pathname}</code>. The link may be mistyped or retired.
        </p>
        <p className="empty-state__body" style={{ marginTop: 8 }}>Your session is still signed in. Choose a destination below.</p>
        <div className="empty-state__actions" style={{ justifyContent: "flex-start" }}>
          <Link to="/" className="page-action-link">GO TO HOME</Link>
          <Link to="/status-center" className="page-action-link">STATUS CENTER</Link>
          <Link to="/directory" className="page-action-link">SITE DIRECTORY</Link>
          <button type="button" className="page-action-link" onClick={() => navigate(-1)}>GO BACK</button>
        </div>
      </section>
    </div>
  )
}
