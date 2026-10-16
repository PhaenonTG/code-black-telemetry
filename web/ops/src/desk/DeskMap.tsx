import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { AtlasMap } from "../../../../src/map/AtlasMap"
import type { RadarFrame } from "../../../../src/services/radar"
import type { RoadConditionEvent, TrafficCamera } from "../../../../src/services/mapLayerModels"
import type { AlertProduct } from "../../../../src/services/situational"
import { useDesk } from "./DeskProvider"
import { useCoreOps } from "../core/useCoreOps"
import { MapCameraViewer } from "../components/MapCameraViewer"
import { MapSituationPanel } from "../components/MapSituationPanel"
import { Panel } from "./DeskPanels"
import { ageLabel, freshUnitLocation, numberField } from "./format"

export function DeskMap({ radar = false, active = true, receiveEvents = true, targetPoints, riskAreas, bounds, onRadarFrame }: { radar?: boolean; active?: boolean; receiveEvents?: boolean; targetPoints?: Array<{ lat: number; lon: number }>; riskAreas?: NonNullable<import("./setupSources").SetupDraft["tornado_tracking_map"]>["features"]; bounds?: [number, number, number, number]; onRadarFrame?: (frame: RadarFrame | null) => void }) {
  const { reference, referenceLabel, activeUnit, unitPosition, units, now, alerts, preferences, updatePreferences, pinnedCameras, togglePin, choosePoint, setRadarFrame, cell } = useDesk()
  const { selectedPoint } = useCoreOps()
  const [camera, setCamera] = useState<TrafficCamera | null>(null)
  const [selection, setSelection] = useState<{ kind: "alert"; alert: AlertProduct } | { kind: "road"; road: RoadConditionEvent } | null>(null)
  const receiveFrame = useCallback((frame: RadarFrame | null) => { if (active) { setRadarFrame(frame); onRadarFrame?.(frame) } }, [setRadarFrame, onRadarFrame, active])
  useEffect(() => () => { if (radar) setRadarFrame(null) }, [radar, setRadarFrame])
  const echo = cell.fresh && cell.sample ? { ...cell.sample.point, label: `${cell.sample.site} dominant echo${cell.sample.trusted ? "" : " · Review needed"}`, trusted: cell.sample.trusted } : null
  useEffect(() => {
    if (!receiveEvents || !active) return
    const onCamera = (event: Event) => { setCamera((event as CustomEvent<TrafficCamera>).detail); setSelection(null) }
    const onAlert = (event: Event) => { setSelection({ kind: "alert", alert: (event as CustomEvent<AlertProduct>).detail }); setCamera(null) }
    const onRoad = (event: Event) => { setSelection({ kind: "road", road: (event as CustomEvent<RoadConditionEvent>).detail }); setCamera(null) }
    window.addEventListener("codeblack:map-camera-open", onCamera); window.addEventListener("codeblack:map-alert-open", onAlert); window.addEventListener("codeblack:map-road-open", onRoad)
    return () => { window.removeEventListener("codeblack:map-camera-open", onCamera); window.removeEventListener("codeblack:map-alert-open", onAlert); window.removeEventListener("codeblack:map-road-open", onRoad) }
  }, [active, receiveEvents])
  const gps = reference ? { ...reference, headingDeg: unitPosition ? numberField(activeUnit?.location, "heading_deg", "heading", "headingDeg") : null, speedMph: unitPosition ? numberField(activeUnit?.location, "speed_mph", "speedMph") : null } : null
  const teamPositions = useMemo(() => units.flatMap((unit) => {
    const point = freshUnitLocation(unit, now)
    return !point || unit.unit_id === activeUnit?.unit_id ? [] : [{ ...point, id: unit.unit_id, name: unit.operator_name || unit.display_name, updatedAtText: ageLabel(unit.last_seen, now), group: unit.display_name, phone: "", email: "" }]
  }), [units, activeUnit?.unit_id, now])
  return <Panel title={radar ? "Radar" : "Situation"} meta={<Link to={radar ? "/radar" : "/map"}>Full workspace ↗</Link>} className={`desk-map ${radar ? "desk-map--radar" : ""}`}>
    <div className="desk-map__screen"><AtlasMap deskControls active={active} gps={gps} teamPositions={teamPositions} rangeRings="off" statusLines={[referenceLabel]} controlsVariant={radar ? "full" : "compact"} layerScope={radar ? "radar" : "situation"} contextTargets={targetPoints} contextRiskAreas={riskAreas} contextBounds={bounds} contextFocus={targetPoints?.some((point) => point.lat === selectedPoint?.lat && point.lon === selectedPoint?.lon) ? selectedPoint : null} contextEcho={echo} alerts={alerts} selectedPoint={selectedPoint} onPointSelect={(point) => choosePoint(point)} onRadarFrame={radar ? receiveFrame : undefined} />
    {camera && <MapCameraViewer camera={camera} onClose={() => setCamera(null)} pinned={pinnedCameras.some((row) => row.id === camera.id)} onTogglePin={() => togglePin(camera)} lowBandwidth={preferences.snapshotMode} onLowBandwidthChange={(snapshotMode) => updatePreferences({ snapshotMode })} />}
    {selection && <MapSituationPanel selection={selection} onClose={() => setSelection(null)} />}</div>
  </Panel>
}
