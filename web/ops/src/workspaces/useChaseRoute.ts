import { useEffect, useState } from "react"
import { hasMapboxToken, mapboxAccessToken } from "../../../../src/services/mapTiles"
import { getRoadConditionsForViewport, type RoadConditionEvent, type ViewportLayerResult } from "../../../../src/services/mapLayerModels"
import { fetchNavigationRoute, type RoutePoint } from "../../../../src/services/navigationRoute"
import { distanceMiles } from "./chaseIntelModel"

type RouteSnapshot = { key: string; path: RoutePoint[]; roads: ViewportLayerResult<RoadConditionEvent> | null; status: "ready" | "unavailable" }
const EMPTY_ROUTE: RoutePoint[] = []

export function useChaseRoute(origin: RoutePoint | null, destination: RoutePoint | null) {
  const [snapshot, setSnapshot] = useState<RouteSnapshot | null>(null)
  // Recalculate after roughly a third of a mile of movement, rather than on every GPS tick.
  const key = origin && destination ? `${Math.round(origin.lat * 200)},${Math.round(origin.lon * 200)}:${destination.lat.toFixed(5)},${destination.lon.toFixed(5)}` : ""
  const tooFar = !!origin && !!destination && distanceMiles(origin, destination) > 80

  useEffect(() => {
    if (!origin || !destination || tooFar || !hasMapboxToken()) return
    let cancelled = false
    let inFlight = false
    let controller: AbortController | null = null
    const load = async () => {
      if (inFlight) return
      inFlight = true
      controller = new AbortController()
      try {
        const path = await fetchNavigationRoute(origin, destination, mapboxAccessToken(), controller.signal)
        if (path.length < 2) throw new Error("No route returned")
        const latitudes = path.map((point) => point.lat)
        const longitudes = path.map((point) => point.lon)
        let roads: ViewportLayerResult<RoadConditionEvent> | null = null
        try {
          roads = await getRoadConditionsForViewport({
            viewport: { north: Math.max(...latitudes) + .1, south: Math.min(...latitudes) - .1,
              east: Math.max(...longitudes) + .1, west: Math.min(...longitudes) - .1, zoom: 9 },
            detail: "medium", sessionId: null,
          })
        } catch { /* Keep the route visible when DOT providers fail. */ }
        if (!cancelled) setSnapshot({ key, path, roads, status: "ready" })
      } catch {
        if (!cancelled) setSnapshot({ key, path: [], roads: null, status: "unavailable" })
      } finally { inFlight = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => { cancelled = true; controller?.abort(); window.clearInterval(timer) }
  }, [key, tooFar]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = snapshot?.key === key ? snapshot : null
  return {
    path: current?.path ?? EMPTY_ROUTE,
    roads: current?.roads ?? null,
    status: !destination ? "idle" : !origin ? "no-origin" : tooFar ? "too-far" : !hasMapboxToken() ? "unavailable" : current?.status ?? "checking",
  } as const
}
