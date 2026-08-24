import { useEffect, useState } from "react"
import { AtlasMap } from "../../../../src/map/AtlasMap"
import { browserLocationAdapter, type LocationState } from "../adapters"
import type { AtlasGpsPoint } from "../../../../src/map/types"

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

// Reuses the existing AtlasMap component directly (see docs/ARCHITECTURE.md) -- mosaic radar,
// layers, road conditions, traffic cameras, and ESCAPE all come along with it unmodified. This is
// the real map, not a rebuild.
export default function MapPage() {
  const [gps, setGps] = useState<LocationState>({ status: "requesting" })
  useEffect(() => {
    let cancelled = false
    void browserLocationAdapter.getCurrent().then((s) => { if (!cancelled) setGps(s) })
    const unwatch = browserLocationAdapter.watch((s) => { if (!cancelled) setGps(s) })
    return () => { cancelled = true; unwatch() }
  }, [])

  return (
    <div className="page-map">
      <AtlasMap gps={toAtlasGps(gps)} rangeRings="off" statusLines={[]} controlsVariant="full" />
    </div>
  )
}
