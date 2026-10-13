import { useEffect, useMemo, useRef, useState } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken } from "../../../../src/services/mapTiles"
import { ageText, getNearestRadarSites, getRadarFrames, getRadarStatus, radarWorkerMissingOnWeb, recommendedRadarRefreshMs, type RadarFrame, type RadarProduct, type RadarSite } from "../../../../src/services/radar"
import { normalizeRadarFrames } from "../../../../src/services/radarLoop"
import { updateAtlasRadarLayer, removeAtlasRadarLayer } from "../../../../src/map/AtlasRadarLayer"
import { AtlasRadarLegend } from "../../../../src/map/AtlasRadarLegend"
import { tuneAtlasStyle } from "../../../../src/map/AtlasStyleManager"
import { loadRadarCandidates, selectRadarFrame } from "./chaseRadarSelection"
import { PEA_RIDGE_REFERENCE } from "../core/referenceLocation"

type Point = { lat: number; lon: number }
const PRODUCTS: RadarProduct[] = ["REF", "VEL", "SRV", "CC"]

export function ChaseRadarPanel({ focus }: { focus: Point | null }) {
  const [product, setProduct] = useState<RadarProduct>("REF")
  const [siteOverride, setSiteOverride] = useState("")
  const [sites, setSites] = useState<RadarSite[]>([])
  const [frame, setFrame] = useState<RadarFrame | null>(null)
  const [error, setError] = useState("")
  const [siteDiscoveryError, setSiteDiscoveryError] = useState("")
  const [checkedAt, setCheckedAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [stormMotionReady, setStormMotionReady] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<InstanceType<typeof mapboxgl.Map> | null>(null)
  const styleReady = useRef(false)
  const frameRef = useRef<RadarFrame | null>(null)
  const requestVersion = useRef(0)
  const point = focus ?? PEA_RIDGE_REFERENCE
  const focusLat = point.lat
  const focusLon = point.lon
  const siteSearchLat = Math.round(focusLat * 20) / 20
  const siteSearchLon = Math.round(focusLon * 20) / 20
  const chosenSite = useMemo(() => sites.find((site) => site.id === siteOverride) ?? sites[0] ?? null, [sites, siteOverride])

  useEffect(() => {
    if (!container.current || !hasMapboxToken()) return
    mapboxgl.accessToken = mapboxAccessToken()
    const instance = new mapboxgl.Map({ container: container.current, style: atlasStyleUri(), center: [focusLon, focusLat], zoom: 7, attributionControl: false })
    map.current = instance
    instance.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right")
    // This repo carries two mapbox-gl type versions. The runtime map instance is the same API.
    instance.on("style.load", () => {
      tuneAtlasStyle(instance as unknown as Parameters<typeof tuneAtlasStyle>[0])
      styleReady.current = true
      if (frameRef.current) updateAtlasRadarLayer(instance as unknown as Parameters<typeof updateAtlasRadarLayer>[0], frameRef.current, 0.82)
    })
    return () => { map.current = null; styleReady.current = false; removeAtlasRadarLayer(instance as unknown as Parameters<typeof removeAtlasRadarLayer>[0]); instance.remove() }
    // Keep one WebGL map alive while radar site, product, and focus change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const instance = map.current
    if (instance) instance.easeTo({ center: [focusLon, focusLat], duration: 400 })
  }, [focusLat, focusLon])

  useEffect(() => {
    const instance = map.current
    frameRef.current = frame
    if (instance && styleReady.current) updateAtlasRadarLayer(instance as unknown as Parameters<typeof updateAtlasRadarLayer>[0], frame, 0.82)
  }, [frame])

  useEffect(() => {
    let cancelled = false
    let retryTimer = 0
    const load = async () => {
      try {
        const next = await getNearestRadarSites(siteSearchLat, siteSearchLon)
        if (next.length === 0) throw new Error("No radar sites returned")
        if (!cancelled) {
          setSites(next.slice(0, 3))
          setSiteDiscoveryError("")
        }
      } catch {
        if (!cancelled) {
          setSiteDiscoveryError("Radar site lookup failed; retrying automatically.")
          setStormMotionReady(false)
          retryTimer = window.setTimeout(() => void load(), 10_000)
        }
      }
    }
    void load()
    return () => { cancelled = true; window.clearTimeout(retryTimer) }
  }, [siteSearchLat, siteSearchLon])

  useEffect(() => {
    setStormMotionReady(false)
    if (!chosenSite) return
    let cancelled = false
    void getRadarStatus(chosenSite.id, product)
      .then((status) => { if (!cancelled) setStormMotionReady(Boolean(status?.stormMotion)) })
      .catch(() => { if (!cancelled) setStormMotionReady(false) })
    return () => { cancelled = true }
  }, [chosenSite, product])

  useEffect(() => {
    if (!chosenSite) return
    let cancelled = false
    let pending = false
    const version = ++requestVersion.current
    const load = async () => {
      if (pending) return
      pending = true
      const candidates = siteOverride ? [chosenSite] : sites
      try {
        const results = await loadRadarCandidates(candidates, async (site) =>
          normalizeRadarFrames(await getRadarFrames(site.id, product, null, 2), 2), Boolean(siteOverride))
        if (cancelled || version !== requestVersion.current) return
        const selected = selectRadarFrame(results)
        setCheckedAt(Date.now())
        if (selected) { setFrame((current) => current?.frameId === selected.frame.frameId ? current : selected.frame); setError("") }
        else { setFrame(null); setError(radarWorkerMissingOnWeb() ? "Radar worker is not configured in this build." : "No radar frame is available from the selected or nearby sites.") }
      } catch {
        if (!cancelled && version === requestVersion.current) { setCheckedAt(Date.now()); setError("Radar refresh failed; showing the last received scan if one exists.") }
      } finally { pending = false }
    }
    void load()
    const timer = window.setInterval(() => void load(), recommendedRadarRefreshMs())
    return () => { cancelled = true; requestVersion.current += 1; window.clearInterval(timer) }
  }, [chosenSite, product, siteOverride, sites])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const scanTime = frame ? Date.parse(frame.time) : NaN
  const ageSeconds = Number.isFinite(scanTime) ? Math.max(0, Math.round((now - scanTime) / 1000)) : null
  const frameState = !frame ? "UNAVAILABLE" : ageSeconds == null || ageSeconds > 18 * 60 || ["STALE", "OFFLINE", "SITE DOWN", "INCOMPLETE"].includes(frame.freshness)
    ? "STALE" : frame.freshness === "LIVE" && ageSeconds <= 6 * 60 ? "LIVE" : "DELAYED"
  return <section className="chase-radar workspace-panel" aria-label="Single-site radar">
    <header><h2>Radar</h2><span>{frame?.site.id ?? chosenSite?.id ?? "NO SITE"} · {frameState}</span></header>
    <div className="chase-radar__controls">
      <label>Site <select aria-label="Radar site" value={siteOverride} onChange={(event) => { setFrame(null); setSiteOverride(event.target.value) }}><option value="">Auto · nearest healthy</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.id} · {site.name}</option>)}</select></label>
      <div role="group" aria-label="Radar product">{PRODUCTS.map((item) => <button type="button" key={item} aria-pressed={product === item} disabled={item === "SRV" && !stormMotionReady} title={item === "SRV" && !stormMotionReady ? "Storm motion is required for storm-relative velocity" : undefined} onClick={() => { setFrame(null); setProduct(item) }}>{item}</button>)}</div>
    </div>
    <div className="chase-radar__viewport">{hasMapboxToken() ? <div ref={container} className="chase-radar__map" role="img" aria-label={`${product} radar from ${frame?.site.id ?? chosenSite?.id ?? "unavailable site"}`} /> : <div className="chase-radar__empty">Mapbox is not configured in this build.</div>}{(!frame || error || siteDiscoveryError) && <div className="chase-radar__message">{error || siteDiscoveryError || "Checking radar frames…"}</div>}</div>
    <div className="chase-radar__legend"><AtlasRadarLegend product={product} /></div>
    <footer><span>{frame ? `${frame.sourceLevel} · ${frame.freshness} · ${ageText(ageSeconds)} old` : checkedAt ? "No scan available" : "Checking…"}</span><span>{frame && Number.isFinite(scanTime) ? new Date(scanTime).toLocaleTimeString() : "Scan time unavailable"}</span></footer>
  </section>
}
