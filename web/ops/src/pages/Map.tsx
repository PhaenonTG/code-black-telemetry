import { useEffect, useState } from "react"
import { AtlasMap } from "../../../../src/map/AtlasMap"
import { browserLocationAdapter, type LocationState } from "../adapters"
import type { AtlasGpsPoint } from "../../../../src/map/types"
import type { TrafficCamera } from "../../../../src/services/mapLayerModels"
import { MapCameraViewer } from "../components/MapCameraViewer"

function toAtlasGps(state: LocationState): AtlasGpsPoint | null {
  if (state.status !== "ready") return null
  return {
    lat: state.lat,
    lon: state.lon,
    accuracyM: state.accuracyM,
    headingDeg: state.headingDeg,
    speedMph: state.speedMph,
  }
}

function gpsStatusLine(state: LocationState) {
  if (state.status === "ready") return `GPS LIVE · ±${Math.round(state.accuracyM)}m`
  if (state.status === "requesting") return "GPS CHECKING"
  if (state.status === "denied") return "GPS DENIED"
  return "GPS UNAVAILABLE"
}

// The Map route is intentionally map-first. Traffic cameras, road incidents and other
// situational layers are selected and consumed without navigating away from the map.
export default function MapPage() {
  const [gps, setGps] = useState<LocationState>({ status: "requesting" })
  const [camera, setCamera] = useState<TrafficCamera | null>(null)

  useEffect(() => {
    let cancelled = false
    void browserLocationAdapter.getCurrent().then((state) => { if (!cancelled) setGps(state) })
    const unwatch = browserLocationAdapter.watch((state) => { if (!cancelled) setGps(state) })
    return () => { cancelled = true; unwatch() }
  }, [])

  useEffect(() => {
    const openCamera = (event: Event) => {
      const selected = (event as CustomEvent<TrafficCamera>).detail
      if (selected?.id) setCamera(selected)
    }
    window.addEventListener("codeblack:map-camera-open", openCamera)
    return () => window.removeEventListener("codeblack:map-camera-open", openCamera)
  }, [])

  return (
    <div className="page-map">
      <AtlasMap
        gps={toAtlasGps(gps)}
        rangeRings="off"
        statusLines={[gpsStatusLine(gps)]}
        controlsVariant="full"
      />
      {camera && <MapCameraViewer camera={camera} onClose={() => setCamera(null)} />}
    </div>
  )
}
