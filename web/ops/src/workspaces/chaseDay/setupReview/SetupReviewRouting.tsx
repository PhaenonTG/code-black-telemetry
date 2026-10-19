import { useEffect, useState } from "react"
import { Navigate, useLocation, useParams } from "react-router-dom"
import { useCoreOps } from "../../../core/useCoreOps"
import { AsyncViewState } from "../../../components/AsyncViewState"
import { analysisDestination, setupLanding, type SetupTab } from "./SetupReviewModel"

export function LegacyAnalysisRedirect() {
  const location = useLocation()
  return <Navigate replace to={analysisDestination(location.pathname, location.search)} />
}
export function LegacyChaseSetupRedirect() {
  const { setupId } = useParams()
  const location = useLocation()
  return <Navigate replace to={`/setup-review/drafts${setupId ? `/${setupId}` : ""}${location.search}`} />
}
export function SetupReviewLanding() {
  const { config } = useCoreOps()
  const location = useLocation()
  const today = new URLSearchParams(location.search).get("mode") === "today"
  const [landing, setLanding] = useState<SetupTab | null>(null)
  useEffect(() => {
    if (today) return
    const controller = new AbortController()
    void setupLanding(config, controller.signal).then(value => { if (!controller.signal.aborted) setLanding(value) })
    return () => controller.abort()
  }, [config, today])
  return today || landing ? <Navigate replace to={`/setup-review/${today ? "today" : landing}${location.search}`} />
    : <AsyncViewState state="loading" title="Checking today's reviewed briefing" />
}
