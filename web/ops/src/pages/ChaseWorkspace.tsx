import { Link } from "react-router-dom"
import { useCoreOps } from "../core/useCoreOps"
import { ChaseRadarPanel } from "../workspaces/ChaseRadarPanel"
import { ChaseIntelRail, ChaseOfficialBanner, useChaseIntel } from "../workspaces/ChaseIntelRail"
import OpsWorkstation from "./OpsWorkstation"
import "./Workspaces.css"
import { useState } from "react"
import { useChaseRoute } from "../workspaces/useChaseRoute"
import type { ChasePoint } from "../workspaces/chaseIntelModel"

export default function ChaseWorkspace() {
  const { config, state, selectedPoint, deviceLocation, locationMode, referenceUnitId, referenceLabel, referenceIsFallback, referenceIsStale, referenceChaserFix, chooseChaserLocation, followDeviceLocation } = useCoreOps()
  const [choosingDestination, setChoosingDestination] = useState(false)
  const [destination, setDestination] = useState<ChasePoint | null>(null)
  const units = state.fabric.units?.units ?? []
  const active = locationMode === "chaser" ? units.find((unit) => unit.unit_id === referenceUnitId) : undefined
  const radarFocus = selectedPoint
  const vehiclePosition = locationMode === "chaser" && !referenceIsFallback && !referenceIsStale
  const lastFix = referenceChaserFix?.observedAt ?? null
  const origin = locationMode === "chaser" ? referenceChaserFix?.point ?? null
    : locationMode === "follow" && !referenceIsFallback && deviceLocation.status === "ready"
      ? { lat: deviceLocation.lat, lon: deviceLocation.lon } : null
  const route = useChaseRoute(origin, destination)
  const intel = useChaseIntel(config, radarFocus)
  const namedUnit = (name: string) => units.find((unit) => `${unit.operator_name ?? ""} ${unit.display_name ?? ""}`.toLowerCase().includes(name.toLowerCase()))
  const nick = namedUnit("nick")
  const spencer = namedUnit("spencer")
  const locationDetail = locationMode === "follow" && deviceLocation.status === "ready"
    ? `±${Math.round(deviceLocation.accuracyM)}m${deviceLocation.speedMph == null ? "" : ` · ${Math.round(deviceLocation.speedMph)} mph`}`
    : locationMode === "chaser" ? (referenceIsStale ? "Last known chaser fix" : referenceIsFallback ? "Waiting for chaser GPS" : "Live chaser GPS")
      : referenceIsFallback ? "Fallback reference" : "Map-selected point"
  return <section className="chase-workspace">
    <header className="workspace-heading"><div><h1>Chase Desk</h1><p>Field position, official alerts, and radar context</p></div><nav aria-label="Chase tools"><button type="button" aria-pressed={choosingDestination} onClick={() => setChoosingDestination((value) => !value)}>{choosingDestination ? "Tap destination on map" : "Set route destination"}</button>{destination && <button type="button" onClick={() => { setDestination(null); setChoosingDestination(false) }}>Clear route</button>}<Link to="/radar">Radar Lab →</Link><Link to="/chase">Team & devices →</Link></nav></header>
    <nav className="chase-reference-bar" aria-label="Chase location reference">
      <span>FOLLOW</span>
      <button type="button" aria-pressed={locationMode === "follow"} onClick={followDeviceLocation}>My device</button>
      <button type="button" disabled={!nick} aria-pressed={referenceUnitId === nick?.unit_id} onClick={() => nick && chooseChaserLocation(nick.unit_id)}>Nick</button>
      <button type="button" disabled={!spencer} aria-pressed={referenceUnitId === spencer?.unit_id} onClick={() => spencer && chooseChaserLocation(spencer.unit_id)}>Spencer</button>
    </nav>
    <div className="chase-unit-strip" aria-label="Active location reference"><div><span>LOCATION REFERENCE</span><strong>{referenceLabel}</strong></div><div><span>GPS / SOURCE</span><strong>{locationDetail}</strong></div><div><span>FABRIC</span><strong>{active?.overall_health ?? state.fabric.state}</strong></div><div><span>{locationMode === "chaser" ? "CHASER FIX" : "REFERENCE UPDATED"}</span><strong>{locationMode === "chaser" ? (lastFix ? new Date(lastFix).toLocaleTimeString() : "Awaiting GPS") : deviceLocation.status === "ready" ? new Date(deviceLocation.at).toLocaleTimeString() : "Unavailable"}</strong></div></div>
    <ChaseOfficialBanner intel={intel} point={radarFocus} vehiclePosition={vehiclePosition} />
    <div className="chase-workspace__split"><div className="chase-map-frame"><OpsWorkstation focus="CHASE SITUATION" embedded routeOverlay={destination ? route.path : undefined} onChaseDestinationSelect={choosingDestination ? (point) => { setDestination(point); setChoosingDestination(false) } : undefined} /></div><ChaseRadarPanel focus={radarFocus} /><ChaseIntelRail intel={intel} point={radarFocus} vehiclePosition={vehiclePosition} route={route} routeOrigin={origin} routeDestination={destination} /></div>
    <p className="workspace-note chase-workspace__note">Official point alerts are authoritative for the reference point. Nearby polygon distance is approximate; road feeds may be incomplete. Aegis candidates are internal and unconfirmed.</p>
  </section>
}
