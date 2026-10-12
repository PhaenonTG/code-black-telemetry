import { useCallback, useEffect, useRef, useState } from "react"
import type { OpsCoreConfig } from "../core/config"
import { analyzeTargetWithRadar, refreshLocalAiAssessment, type LocalAiAssessment } from "../localAiAdvisory"
import { rememberReview, reviewPointKey, type PointReviews, type ReviewSelection } from "./aegisReview"

export function useAegisReviews(config: OpsCoreConfig, acceptFleet: (value: LocalAiAssessment) => void) {
  const [stored, setStored] = useState<{ config: OpsCoreConfig; reviews: PointReviews }>({ config, reviews: {} })
  const reviews = stored.config === config ? stored.reviews : {}
  const [pending, setPending] = useState("")
  const [fleetError, setFleetError] = useState("")
  const [fleetRequestedAt, setFleetRequestedAt] = useState(0)
  const requestRef = useRef<AbortController | null>(null)
  const attempts = useRef(new Map<string, number>())
  useEffect(() => () => { requestRef.current?.abort(); requestRef.current = null }, [config])
  const run = useCallback(async (selection?: ReviewSelection) => {
    const key = selection ? reviewPointKey(selection.point) : "fleet"
    const requestedAt = Date.now()
    if (!key || requestRef.current || requestedAt - (attempts.current.get(key) ?? 0) < 30_000) return
    attempts.current.set(key, requestedAt)
    // Cap cooldown bookkeeping as well as visible history when an operator explores many points.
    if (attempts.current.size > 40) attempts.current.delete(attempts.current.keys().next().value!)
    const controller = new AbortController()
    requestRef.current = controller; setPending(key)
    if (!selection) { setFleetError(""); setFleetRequestedAt(requestedAt) }
    const timeout = window.setTimeout(() => controller.abort(), 95_000)
    try {
      if (selection) {
        const value = await analyzeTargetWithRadar(config, selection.point, controller.signal)
        if (requestRef.current === controller && !controller.signal.aborted) setStored((current) => ({ config, reviews: rememberReview(current.config === config ? current.reviews : {}, key, { value, error: "", requestedAt, selection }) }))
      } else {
        const value = await refreshLocalAiAssessment(config, controller.signal)
        if (requestRef.current === controller && !controller.signal.aborted) acceptFleet(value)
      }
    } catch {
      if (requestRef.current !== controller) return
      const error = "Review not confirmed. The server may still be processing; no automatic retry was sent."
      if (selection) setStored((current) => {
        const previous = current.config === config ? current.reviews : {}
        return { config, reviews: rememberReview(previous, key, { value: previous[key]?.value ?? null, error, requestedAt, selection: previous[key]?.selection ?? selection }) }
      })
      else setFleetError(error)
    } finally {
      window.clearTimeout(timeout)
      if (requestRef.current === controller) { requestRef.current = null; setPending("") }
    }
  }, [config, acceptFleet])
  return { reviews, pending, fleetError, fleetRequestedAt, run }
}
