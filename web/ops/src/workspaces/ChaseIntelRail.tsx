import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { fetchForecast } from "../core/client"
import type { OpsCoreConfig } from "../core/config"
import { getAegisFeed, type AegisAlertFeed } from "../core/aegisFeed"
import { getRoadConditionsForViewport, type ViewportLayerResult, type RoadConditionEvent } from "../../../../src/services/mapLayerModels"
import { getNearbyStormThreats, type NearbyThreatCoverage } from "../../../../src/services/situational"
import { distanceMiles, nearbyRoadConditions, topOfficialAlert, type ChasePoint, type OfficialAlert } from "./chaseIntelModel"

type OfficialResponse = { status: string; queried_at?: string; alerts?: OfficialAlert[]; notice?: string }
type Snapshot = { point: ChasePoint; checkedAt: number; official: OfficialResponse | null; officialError: boolean; nearby: NearbyThreatCoverage | null; roads: ViewportLayerResult<RoadConditionEvent> | null; aegis: AegisAlertFeed | null }

function safeLink(value: string | undefined) { return value?.startsWith("https://api.weather.gov/") ? value : null }
function timeLabel(value: number) { return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }

export function useChaseIntel(config: OpsCoreConfig, point: ChasePoint | null) {
  const latestPoint = useRef(point)
  const hasPoint = point !== null
  useEffect(() => { latestPoint.current = point }, [point])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  useEffect(() => {
    let cancelled = false
    let inFlight = false
    const load = async () => {
      if (inFlight) return
      const latitude = latestPoint.current?.lat
      const longitude = latestPoint.current?.lon
      if (latitude == null || longitude == null) return
      inFlight = true
      const point = { lat: latitude, lon: longitude }
      const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) })
      const context = Promise.allSettled([
        getNearbyStormThreats(point),
        getRoadConditionsForViewport({ viewport: { north: latitude + .4, south: latitude - .4, east: longitude + .5, west: longitude - .5, zoom: 9 }, detail: "medium", sessionId: null }),
        getAegisFeed(config),
      ])
      const officialResult = await Promise.allSettled([fetchForecast<OfficialResponse>(config, `alerts?${params}`)])
      const official = officialResult[0].status === "fulfilled" ? officialResult[0].value : null
      const officialError = officialResult[0].status === "rejected"
      const checkedAt = Date.now()
      if (!cancelled) setSnapshot({ point, checkedAt, official, officialError, nearby: null, roads: null, aegis: null })
      const [nearbyResult, roadResult, aegisResult] = await context
      const nearby = nearbyResult.status === "fulfilled" ? nearbyResult.value : null
      if (!cancelled) setSnapshot({ point, checkedAt, official, officialError, nearby,
        roads: roadResult.status === "fulfilled" ? roadResult.value : null,
        aegis: aegisResult.status === "fulfilled" ? aegisResult.value : null })
      inFlight = false
    }
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 30_000)
    return () => { cancelled = true; window.clearTimeout(initial); window.clearInterval(timer) }
  }, [config, hasPoint])
  return point && snapshot && distanceMiles(point, snapshot.point) <= .5 ? snapshot : null
}

export function ChaseOfficialBanner({ intel, point, vehiclePosition }: { intel: Snapshot | null; point: ChasePoint | null; vehiclePosition: boolean }) {
  const official = intel?.official
  const alert = official?.status === "ready" ? topOfficialAlert(official.alerts ?? []) : null
  const source = vehiclePosition ? "vehicle GPS" : "map reference · not vehicle GPS"
  const label = !point ? "Choose a map point or wait for unit GPS to check official warnings" : !intel ? "Checking official warnings…" : intel.officialError || official?.status !== "ready" ? "Official warning check unavailable" : alert ? alert.event || alert.headline || "Official NWS alert" : "No active warning returned for this point"
  const link = safeLink(alert?.source_url ?? alert?.id)
  return <section className={`chase-official ${alert ? "chase-official--active" : intel?.officialError ? "chase-official--unavailable" : ""}`} aria-label="Official warning at reference point" aria-live="polite">
    <div><span>OFFICIAL WARNINGS · {source.toUpperCase()}</span><strong>{label}</strong><small>{alert?.headline && alert.headline !== label ? alert.headline : point ? `${intel?.point.lat.toFixed(3) ?? point.lat.toFixed(3)}, ${intel?.point.lon.toFixed(3) ?? point.lon.toFixed(3)} · ${intel ? `checked ${timeLabel(intel.checkedAt)}` : "checking"} · Not an all-clear` : "Position unavailable"}</small></div>
    {link && <a href={link} target="_blank" rel="noreferrer">NWS SOURCE ↗</a>}
  </section>
}

export function ChaseIntelRail({ intel, point, vehiclePosition }: { intel: Snapshot | null; point: ChasePoint | null; vehiclePosition: boolean }) {
  const roads = point && intel?.roads ? nearbyRoadConditions(intel.roads.data, point) : []
  const candidates = point && intel?.aegis ? intel.aegis.items.filter((item) => {
    const created = Date.parse(item.created_at)
    const [lon, lat] = item.candidate.coordinates
    return Number.isFinite(created) && intel !== null && intel.checkedAt - created < 30 * 60_000 && Number.isFinite(lat) && Number.isFinite(lon) && distanceMiles(point, { lat, lon }) <= 25
  }).slice(0, 2) : []
  return <aside className="chase-intel" aria-label="Chase field intelligence">
    <section className="workspace-panel"><header><h2>Nearby warnings</h2><span>NWS · approximate</span></header>
      {!point ? <p>Waiting for a reference location.</p> : !intel ? <p>Checking nearby warning polygons…</p> : intel.nearby === null ? <p>Checking nearby warning coverage…</p> : <>{!intel.nearby.complete && <p>Nearby warning coverage incomplete. Check the NWS source before making a field decision.</p>}{intel.nearby.threats.length === 0 ? <p>No polygon warnings returned for {intel.nearby.states.join(", ") || "the reference area"}. This is not an all-clear.</p> : <div className="chase-intel__items">{intel.nearby.threats.map(({ alert, inside, distanceMi, bearingCardinal }) => <div key={alert.id}><strong>{alert.title}</strong><span>{inside ? "Reference point inside polygon" : `~${Math.round(distanceMi)} mi ${bearingCardinal} · nearest polygon vertex`}</span><small>{alert.area}</small>{safeLink(alert.id) && <a href={alert.id} target="_blank" rel="noreferrer">NWS product ↗</a>}</div>)}</div>}</>}
    </section>
    <section className="workspace-panel"><header><h2>Road conditions</h2><span>DOT · within ~25 mi</span></header>
      {!point ? <p>Waiting for a reference location.</p> : !intel ? <p>Checking providers…</p> : !intel.roads || !["ready", "empty", "stale"].includes(intel.roads.status) ? <p>{intel.roads?.message || "Road provider unavailable."}</p> : roads.length === 0 ? <p>No nearby provider events returned. Road coverage is not a route-safety check.</p> : <div className="chase-intel__items">{roads.map(({ road, distanceMi }) => <div key={road.id}><strong>{road.roadway || road.title}</strong><span>~{Math.round(distanceMi)} mi · {road.closureState} · {road.freshness}</span><small>{road.title}</small>{road.sourceUrl?.startsWith("https://") && <a href={road.sourceUrl} target="_blank" rel="noreferrer">Provider ↗</a>}</div>)}</div>}
    </section>
    <section className="workspace-panel"><header><h2>Field target</h2><span>{vehiclePosition ? "UNIT GPS" : "MAP REFERENCE"}</span></header><p>{point ? `${point.lat.toFixed(3)}, ${point.lon.toFixed(3)} · ${vehiclePosition ? "reported unit position" : "map reference; unit position unavailable"}` : "No unit position or selected point."}</p></section>
    <section className="workspace-panel"><header><h2>Aegis internal</h2><Link to="/aegis-alerts">Open feed ↗</Link></header>{!intel?.aegis ? <p>Internal radar feed unavailable.</p> : candidates.length === 0 ? <p>No recent nearby candidate returned. Internal analysis is not an official warning.</p> : <div className="chase-intel__items">{candidates.map((item) => <div key={item.id}><strong>{item.radar.site} · candidate</strong><span>Evidence {item.rating.evidence_score} / 100 · unconfirmed</span><small>{item.official_warning.event} · {timeLabel(Date.parse(item.created_at))}</small></div>)}</div>}</section>
  </aside>
}
