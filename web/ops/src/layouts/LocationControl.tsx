import { useEffect, useRef, useState } from "react"
import { useCoreOps } from "../core/useCoreOps"
import { isChaserUnit, liveChaserPoint, timestampMs } from "../core/referenceLocation"

export function LocationControl() {
  const picker = useRef<HTMLSelectElement>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const { referenceChaserFix, state, selectedPoint, locationMode, referenceUnitId, referenceLabel, referenceIsFallback, referenceIsStale, deviceLocation, chooseChaserLocation, followDeviceLocation, chooseFallbackLocation } = useCoreOps()
  const chasers = (state.fabric.units?.units ?? []).filter(isChaserUnit)
  const value = locationMode === "chaser" ? `chaser:${referenceUnitId}` : locationMode
  const detail = referenceIsFallback && locationMode === "follow"
    ? deviceLocation.status === "denied" ? "Location permission denied · using Pea Ridge, AR" : "Waiting for browser GPS · using Pea Ridge, AR"
    : referenceLabel
  return <div className="location-control" data-fallback={referenceIsFallback} title={detail}>
    <span className="location-control__indicator" aria-hidden="true" />
    <label className="location-control__choice"><span>Location</span><select ref={picker} aria-label="OPS location reference" value={value} onChange={(event) => {
      const next = event.target.value
      if (next.startsWith("chaser:")) chooseChaserLocation(next.slice(7))
      else if (next === "fallback") chooseFallbackLocation()
      else if (next === "follow") followDeviceLocation()
    }}>
      <option value="follow">My location</option>
      <optgroup label="Chasers">
        {chasers.map((unit) => {
          const lastAt = timestampMs(unit.location?.observed_at ?? unit.location?.timestamp ?? unit.location?.updated_at)
            ?? (unit.unit_id === referenceUnitId ? referenceChaserFix?.observedAt : null)
          const lastFix = lastAt ? ` - last fix ${Math.max(0, Math.floor((now - lastAt) / 60_000))}m ago` : ""
          return <option key={unit.unit_id} value={`chaser:${unit.unit_id}`}>{unit.operator_name || unit.display_name} · {liveChaserPoint(unit, now) ? "GPS reporting" : `GPS unavailable${lastFix}`}</option>})}
        {locationMode === "chaser" && !chasers.some((unit) => unit.unit_id === referenceUnitId) && <option value={value}>Selected chaser · waiting for Fabric · GPS unavailable{referenceChaserFix ? ` - last fix ${Math.max(0, Math.floor((now - referenceChaserFix.observedAt) / 60_000))}m ago` : ""}</option>}
        {chasers.length === 0 && locationMode !== "chaser" && <option disabled>No chasers reporting</option>}
      </optgroup>
      <option value="fallback">Pea Ridge, AR</option>
      {locationMode === "manual" && <option value="manual">Map point</option>}
    </select></label>
    <span className="location-control__detail" role="status"><span className="location-control__name">{referenceIsFallback ? locationMode === "chaser" ? referenceLabel : "Pea Ridge, AR" : selectedPoint ? `${selectedPoint.lat.toFixed(3)}, ${selectedPoint.lon.toFixed(3)}` : referenceLabel}</span><small>{referenceIsStale ? "Last verified chaser position" : referenceIsFallback ? locationMode === "fallback" ? "Fixed reference" : "Fallback" : locationMode === "manual" ? "Selected point" : "GPS reference"}</small></span>
    {referenceIsFallback && <button type="button" className="location-control__fallback" onClick={() => { picker.current?.focus() }}>Using fallback location - no chaser GPS <span>Choose location</span></button>}
  </div>
}
