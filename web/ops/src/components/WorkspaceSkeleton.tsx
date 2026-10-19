import { useLocation } from "react-router-dom"
import "./WorkspaceSkeleton.css"

export function WorkspaceSkeleton({ title = "Opening chase workspace" }: { title?: string }) {
  return <div className="workspace-skeleton" role="status" aria-live="polite" aria-label={title}>
    <strong className="workspace-skeleton__title">{title}</strong>
    <div className="workspace-skeleton__layout" aria-hidden="true">
      <div className="workspace-skeleton__map" />
      <div className="workspace-skeleton__rail"><span /><span /><span /></div>
    </div>
  </div>
}

export function RouteLoading() {
  const { pathname } = useLocation()
  return /^\/(chase-desk|setup-review|analysis|chase-setups)(\/|$)/.test(pathname)
    ? <WorkspaceSkeleton /> : <div className="page-empty">Loading…</div>
}
