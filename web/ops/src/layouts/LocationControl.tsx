import { useCoreOps } from "../core/useCoreOps"
import { isChaserUnit, liveChaserPoint } from "../core/referenceLocation"

export function LocationControl() {
  const { state, selectedPoint, locationMode, referenceUnitId, referenceLabel, referenceIsFallback, referenceIsStale, deviceLocation, chooseChaserLocation, followDeviceLocation, chooseFallbackLocation } = useCoreOps()
  const chasers = (state.fabric.units?.units ?? []).filter(isChaserUnit)
  const value = locationMode === "chaser" ? `chaser:${referenceUnitId}` : locationMode
  const detail = referenceIsFallback && locationMode === "follow"
    ? deviceLocation.status === "denied" ? "Location permission denied · using Pea Ridge, AR" : "Waiting for browser GPS · using Pea Ridge, AR"
    : referenceLabel
  return <div className="location-control" data-fallback={referenceIsFallback} title={detail}>
    <span className="location-control__indicator" aria-hidden="true" />
    <label className="location-control__choice"><span>Location</span><select aria-label="OPS location reference" value={value} onChange={(event) => {
      const next = event.target.value
      if (next.startsWith("chaser:")) chooseChaserLocation(next.slice(7))
      else if (next === "fallback") chooseFallbackLocation()
      else if (next === "follow") followDeviceLocation()
    }}>
      <option value="follow">My location</option>
      <optgroup label="Chasers">
        {chasers.map((unit) => <option key={unit.unit_id} value={`chaser:${unit.unit_id}`}>{unit.operator_name || unit.display_name} · {liveChaserPoint(unit) ? "GPS reporting" : "GPS unavailable"}</option>)}
        {locationMode === "chaser" && !chasers.some((unit) => unit.unit_id === referenceUnitId) && <option value={value}>Selected chaser · waiting for Fabric</option>}
        {chasers.length === 0 && locationMode !== "chaser" && <option disabled>No chasers reporting</option>}
      </optgroup>
      <option value="fallback">Pea Ridge, AR</option>
      {locationMode === "manual" && <option value="manual">Map point</option>}
    </select></label>
    <span className="location-control__detail" role="status">{referenceIsFallback ? locationMode === "chaser" ? referenceLabel : "Pea Ridge, AR" : selectedPoint ? `${selectedPoint.lat.toFixed(3)}, ${selectedPoint.lon.toFixed(3)}` : referenceLabel}<small>{referenceIsStale ? "Last verified chaser position" : referenceIsFallback ? locationMode === "fallback" ? "Fixed reference" : "Fallback" : locationMode === "manual" ? "Selected point" : "GPS reference"}</small></span>
  </div>
}
