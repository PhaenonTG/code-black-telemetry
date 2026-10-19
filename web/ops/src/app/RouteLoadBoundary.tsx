import { Component, type ErrorInfo, type ReactNode } from "react"
import { useLocation } from "react-router-dom"

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Ops page failed to load", error, info.componentStack)
  }

  render() {
    if (this.state.failed) return <div className="page-empty" role="alert">
      <h2>Page could not load</h2>
      <p>A new version or a temporary network problem may have interrupted this page.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload Ops</button>
    </div>
    return this.props.children
  }
}

export function RouteLoadBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  return <Boundary key={location.pathname}>{children}</Boundary>
}
