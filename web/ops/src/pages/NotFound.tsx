import { Link, useLocation, useNavigate } from "react-router-dom"

// Page-scoped styles (no NotFound CSS file is in the allowed list). Motion only under
// prefers-reduced-motion: no-preference, transform/opacity only.
const NOT_FOUND_CSS = `
.ops-not-found{display:grid;place-items:center;min-height:min(70vh,640px)}
.ops-not-found__card{position:relative;overflow:hidden;width:min(100%,600px);padding:36px 32px 30px;border:1px solid var(--cb-line);border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,0) 38%),repeating-linear-gradient(90deg,rgba(255,255,255,.013) 0 1px,transparent 1px 3px),linear-gradient(160deg,var(--cb-panel-hi),var(--cb-panel) 70%);box-shadow:0 18px 48px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.06)}
.ops-not-found__card::before{content:"";position:absolute;left:20px;right:20px;top:0;height:1px;background:linear-gradient(90deg,transparent,var(--cb-red) 15%,var(--cb-red) 85%,transparent);box-shadow:0 0 12px rgba(255,42,12,.8)}
.ops-not-found__card::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 40%,rgba(255,255,255,.05) 50%,transparent 60%);transform:translateX(-120%);pointer-events:none}
.ops-not-found__kicker{margin:0 0 10px;color:var(--cb-amber);font-size:11px;font-weight:800;letter-spacing:.18em}
.ops-not-found__title{margin:0 0 14px;font-family:Anton,Inter,ui-sans-serif,system-ui,sans-serif;font-weight:400;font-size:clamp(30px,6vw,44px);line-height:1.05;letter-spacing:.03em;text-transform:uppercase;color:var(--cb-text)}
.ops-not-found__code{color:var(--cb-red);text-shadow:0 0 14px rgba(255,42,12,.55)}
.ops-not-found__body{margin:0;color:var(--cb-text);font-size:15px;line-height:1.6}
.ops-not-found__body code{overflow-wrap:anywhere;color:var(--cb-amber)}
.ops-not-found__hint{margin:8px 0 0;color:var(--cb-muted);font-size:13px}
.ops-not-found__actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.ops-not-found__actions :is(a,button){display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid var(--cb-line);border-radius:10px;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,0));color:var(--cb-text);font:inherit;font-size:11px;font-weight:800;letter-spacing:.1em;cursor:pointer;text-decoration:none}
.ops-not-found__actions .ops-not-found__primary{border-color:rgba(255,42,12,.6);box-shadow:0 0 14px -5px rgba(255,42,12,.9)}
.ops-not-found__actions :is(a,button):hover{border-color:var(--cb-red);box-shadow:0 0 16px -4px rgba(255,42,12,.9)}
.ops-not-found__actions :is(a,button):focus-visible{outline:2px solid var(--cb-red);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){
.ops-not-found__card{animation:cb-nf-in 420ms cubic-bezier(.2,.8,.2,1) both}
.ops-not-found__card::after{animation:cb-nf-sweep 1400ms 300ms cubic-bezier(.4,0,.2,1) both}
.ops-not-found__actions :is(a,button){transition:border-color 180ms,box-shadow 220ms cubic-bezier(.2,.8,.2,1),transform 160ms}
.ops-not-found__actions :is(a,button):active{transform:scale(.97)}
@keyframes cb-nf-in{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes cb-nf-sweep{to{transform:translateX(120%)}}
}
`

// Client-side "page not found" view for unknown authenticated OPS paths. It replaces the earlier
// silent redirect to Home so a mistyped or retired link is visible. This is presentation only:
// the HTTP status returned by Pages/Worker routing is unchanged (still the SPA fallback).
export default function NotFound() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <div className="page page-not-found ops-not-found">
      <style href="cb-brand-not-found" precedence="default">{NOT_FOUND_CSS}</style>
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
