import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { browserLocationAdapter, ipLocationAdapter, type LocationState } from "../adapters"
import { useCoreOps } from "../core/useCoreOps"
import { coreConfigured } from "../core/config"
import { useAlertProducts } from "../../../../src/hooks/useAlertProducts"
import { getRoadConditionsForViewport, getTrafficCamerasForViewport, type RoadConditionEvent, type TrafficCamera, type ViewportLayerResult } from "../../../../src/services/mapLayerModels"
import { loadLocalAiAssessment, type LocalAiAssessment } from "../localAiAdvisory"
import { loadAegisObservationPlan, type AegisObservationPlan } from "../aegisObservation"
import { loadWeatherAlertSettings, type WeatherAlertSettings } from "../weatherAlertSettings"
import { loadSetupIndex, type SetupIndex } from "./setupSources"
import { coordinates, currentAlerts, distanceMiles, freshUnitLocation, type Point } from "./format"
import { CAMERA_WALL_KEY, persistDeskPreferences, readDeskPreferences, type DeskPreferences } from "./preferences"
import { useAegisReviews } from "./useAegisReviews"
import { appendCellSample, cellEvidence, type CellSample } from "./cellEvidence"
import { reviewPointKey, type ReviewSelection } from "./aegisReview"
import type { RadarFrame } from "../../../../src/services/radar"

function readPinned(): TrafficCamera[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CAMERA_WALL_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((row): row is TrafficCamera => row && typeof row.id === "string" && typeof row.name === "string" && coordinates(row) != null && row.provider != null).slice(0, 9) : []
  } catch { return [] }
}

function useDeskState() {
  const { state, config, selectedPoint, selectPoint } = useCoreOps()
  const [preferences, setPreferences] = useState(readDeskPreferences)
  const [gps, setGps] = useState<LocationState>({ status: "requesting" })
  const [approximate, setApproximate] = useState<Point | null>(null)
  const [pinnedCameras, setPinnedCameras] = useState(readPinned)
  const [knownCameras, setKnownCameras] = useState(() => new Map(pinnedCameras.map((camera) => [camera.id, camera])))
  const [cameraResult, setCameraResult] = useState<ViewportLayerResult<TrafficCamera> | null>(null)
  const [roadResult, setRoadResult] = useState<ViewportLayerResult<RoadConditionEvent> | null>(null)
  const [ai, setAi] = useState<LocalAiAssessment | null>(null)
  const [previousAi, setPreviousAi] = useState<LocalAiAssessment | null>(null)
  const aiRef = useRef<LocalAiAssessment | null>(null)
  const [observation, setObservation] = useState<AegisObservationPlan | null>(null)
  const [settings, setSettings] = useState<WeatherAlertSettings | null>(null)
  const [setups, setSetups] = useState<SetupIndex | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [now, setNow] = useState(Date.now)
  const [selection, setSelection] = useState<ReviewSelection | null>(null)
  const [radarFrame, setRadarFrame] = useState<RadarFrame | null>(null)
  const [cellHistory, setCellHistory] = useState<CellSample[]>([])
  const acceptFleet = useCallback((value: LocalAiAssessment) => {
    const prior = aiRef.current
    if (prior && Date.parse(prior.generated_at) > Date.parse(value.generated_at)) return
    if (prior && (prior.assessment_generated_at ?? prior.generated_at) !== (value.assessment_generated_at ?? value.generated_at)) setPreviousAi(prior)
    aiRef.current = value; setAi(value)
  }, [])
  const aegis = useAegisReviews(config, acceptFleet)
  const choosePoint = useCallback((point: Point, context?: Omit<ReviewSelection, "point">) => {
    selectPoint(point)
    setSelection({ point, label: context?.label ?? "Map point", ...context })
  }, [selectPoint])
  const reviewSelection: ReviewSelection | null = selectedPoint ? selection && reviewPointKey(selection.point) === reviewPointKey(selectedPoint) ? selection : { point: selectedPoint, label: "Map point" } : null
  const cell = useMemo(() => cellEvidence(observation, now, !!errors.Observation), [observation, now, errors.Observation])

  const updatePreferences = useCallback((patch: Partial<DeskPreferences>) => setPreferences((current) => ({ ...current, ...patch, version: 1 })), [])
  useEffect(() => { persistDeskPreferences(preferences) }, [preferences])
  useEffect(() => { try { localStorage.setItem(CAMERA_WALL_KEY, JSON.stringify(pinnedCameras)) } catch { /* Session pins still work. */ } }, [pinnedCameras])
  useEffect(() => {
    let cancelled = false
    void browserLocationAdapter.getCurrent().then((value) => { if (!cancelled) setGps(value) })
    const stop = browserLocationAdapter.watch((value) => { if (!cancelled) setGps(value) })
    return () => { cancelled = true; stop() }
  }, [])
  useEffect(() => {
    if (gps.status !== "denied" && gps.status !== "unavailable") return
    let cancelled = false
    void ipLocationAdapter.getApprox().then((point) => { if (!cancelled) setApproximate(point ? { lat: point.lat, lon: point.lon } : null) })
    return () => { cancelled = true }
  }, [gps.status])

  const units = state.fabric.units?.units ?? []
  const activeUnit = units.find((unit) => unit.unit_id === preferences.unitId)
    ?? (!preferences.unitId ? units.find((unit) => unit.unit_id === config.unitId) ?? units.find((unit) => unit.unit_type === "chase-platform") : null) ?? null
  const unitPosition = freshUnitLocation(activeUnit, now)
  const devicePosition = gps.status === "ready" ? { lat: gps.lat, lon: gps.lon } : null
  const reference = unitPosition ?? devicePosition ?? approximate
  const referenceLabel = unitPosition ? activeUnit?.operator_name || activeUnit?.display_name || "Chase unit" : devicePosition ? "This device" : approximate ? "Approximate location" : "No current position"
  const alertsState = useAlertProducts(reference, true)
  const alerts = useMemo(() => currentAlerts(alertsState.products, now), [alertsState.products, now])
  const focusLat = reference ? Math.round(reference.lat * 10) / 10 : null
  const focusLon = reference ? Math.round(reference.lon * 10) / 10 : null

  useEffect(() => {
    if (!selectedPoint && reference) selectPoint(reference)
  }, [selectedPoint, reference, selectPoint])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  // Published server results only: this minute poll never invokes an LLM or a paid run.
  useEffect(() => {
    if (!coreConfigured(config)) return
    let cancelled = false, busy = false
    let controller: AbortController | null = null
    const refresh = async () => {
      if (busy || document.hidden) return
      busy = true; controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 12_000)
      const results = await Promise.allSettled([
        loadLocalAiAssessment(config, controller.signal), loadAegisObservationPlan(config, controller.signal),
        loadWeatherAlertSettings(controller.signal), loadSetupIndex(config, controller.signal),
      ])
      window.clearTimeout(timeout); busy = false
      if (cancelled) return
      const [nextAi, nextPlan, nextSettings, nextSetups] = results
      if (nextAi.status === "fulfilled") acceptFleet(nextAi.value)
      if (nextPlan.status === "fulfilled") {
        setObservation(nextPlan.value)
        const receivedAt = Date.now()
        const evidence = cellEvidence(nextPlan.value, receivedAt)
        setCellHistory((history) => appendCellSample(history, evidence.fresh ? evidence.sample : null, receivedAt))
      }
      if (nextSettings.status === "fulfilled") setSettings(nextSettings.value)
      if (nextSetups.status === "fulfilled") setSetups(nextSetups.value)
      setErrors(Object.fromEntries(results.flatMap((result, index) => result.status === "rejected" ? [[ ["Aegis", "Observation", "Target", "Setups"][index], "Source unavailable" ]] : [])))
      setCheckedAt(Date.now())
    }
    void refresh()
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener("visibilitychange", refresh)
    return () => { cancelled = true; controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [config, refreshTick, acceptFleet])

  useEffect(() => {
    if (focusLat == null || focusLon == null) return
    let cancelled = false, busy = false
    let controller: AbortController | null = null
    const refresh = async () => {
      if (busy || document.hidden) return
      busy = true; controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 15_000)
      const context = { viewport: { north: focusLat + .65, south: focusLat - .65, east: focusLon + .85, west: focusLon - .85, zoom: 8 }, detail: "medium" as const, sessionId: null }
      const results = await Promise.allSettled([getTrafficCamerasForViewport(context, controller.signal), getRoadConditionsForViewport(context, controller.signal)])
      window.clearTimeout(timeout); busy = false
      if (cancelled) return
      if (results[0].status === "fulfilled") setCameraResult(results[0].value)
      else setCameraResult((current) => ({ data: current?.data ?? [], status: "unavailable", message: "Camera check failed. Last received feeds may be stale.", simulated: false, fetchedAt: current?.fetchedAt ?? 0, stale: true }))
      if (results[1].status === "fulfilled") setRoadResult(results[1].value)
      else setRoadResult((current) => ({ data: current?.data ?? [], status: "unavailable", message: "Road check failed. Last received events may be stale.", simulated: false, fetchedAt: current?.fetchedAt ?? 0, stale: true }))
    }
    void refresh(); const timer = window.setInterval(refresh, 120_000)
    document.addEventListener("visibilitychange", refresh)
    return () => { cancelled = true; controller?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [focusLat, focusLon, refreshTick])

  const cameras = useMemo(() => {
    const latest = new Map((cameraResult?.data ?? []).map((camera) => [camera.id, camera]))
    const selected = knownCameras.get(preferences.primaryCameraId)
    if (selected && !latest.has(selected.id)) latest.set(selected.id, selected)
    const pinnedIds = new Set(pinnedCameras.map((camera) => camera.id))
    const pinned = pinnedCameras.map((camera) => latest.get(camera.id) ?? camera)
    const nearby = [...latest.values()].filter((camera) => !pinnedIds.has(camera.id) && camera.availability !== "offline")
    if (reference) nearby.sort((a, b) => distanceMiles(reference, a) - distanceMiles(reference, b))
    return [...pinned, ...nearby].slice(0, 30)
  }, [pinnedCameras, cameraResult, reference, preferences.primaryCameraId, knownCameras])
  const primaryCamera = cameras.find((camera) => camera.id === preferences.primaryCameraId) ?? cameras[0] ?? null
  const togglePin = useCallback((camera: TrafficCamera) => {
    setKnownCameras((current) => new Map(current).set(camera.id, camera))
    setPinnedCameras((current) => current.some((row) => row.id === camera.id) ? current.filter((row) => row.id !== camera.id) : [...current, camera].slice(-9))
  }, [])
  const refreshAlerts = alertsState.refresh
  const refresh = useCallback(() => { setRefreshTick((tick) => tick + 1); refreshAlerts() }, [refreshAlerts])
  const removePin = useCallback((id: string) => setPinnedCameras((current) => current.filter((camera) => camera.id !== id)), [])
  return { preferences, updatePreferences, gps, units, activeUnit, unitPosition, reference, referenceLabel, alerts, alertsError: alertsState.error,
    alertsCheckedAt: alertsState.checkedAt, alertsChecking: alertsState.checking,
    cameras, primaryCamera, pinnedCameras, togglePin, removePin, cameraResult, roadResult, ai, previousAi, observation, settings, setups, errors, checkedAt, refresh, now,
    aegis, reviewSelection, choosePoint, radarFrame, setRadarFrame, cell, cellHistory: cellHistory.filter((sample) => now - Date.parse(sample.observedAt) < 30 * 60_000) }
}

type DeskState = ReturnType<typeof useDeskState>
const DeskContext = createContext<DeskState | null>(null)
export function DeskProvider({ children }: { children: ReactNode }) {
  const value = useDeskState()
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>
}
export function useDesk(): DeskState {
  const value = useContext(DeskContext)
  if (!value) throw new Error("DeskProvider is required")
  return value
}
