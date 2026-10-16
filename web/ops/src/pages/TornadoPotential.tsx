import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken } from "../../../../src/services/mapTiles"
import { fetchForecast } from "../core/client"
import { useCoreOps } from "../core/useCoreOps"
import { parsePotential, type PotentialPayload } from "../workspaces/tornadoPotentialModel"
import "./TornadoPotential.css"

const time = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Unavailable"

function PotentialMap({ data, stormOnly }: { data: PotentialPayload | null; stormOnly: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<InstanceType<typeof mapboxgl.Map> | null>(null)
  const latest = useRef({ data, stormOnly })
  latest.current = { data, stormOnly }
  const [error, setError] = useState("")
  const update = () => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const current = latest.current
    const features = current.data?.features.filter(feature => !current.stormOnly || feature.properties.storm_supported === true) ?? []
    const source = map.getSource("codeblack-tornado-potential") as mapboxgl.GeoJSONSource | undefined
    source?.setData({ type: "FeatureCollection", features } as mapboxgl.GeoJSONSourceSpecification["data"])
  }
  useEffect(() => {
    if (!container.current || !hasMapboxToken()) return
    mapboxgl.accessToken = mapboxAccessToken()
    const map = new mapboxgl.Map({ container: container.current, style: atlasStyleUri(), center: [-96, 38], zoom: 3.7,
      attributionControl: false, performanceMetricsCollection: false })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right")
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right")
    map.on("load", () => {
      map.addSource("codeblack-tornado-potential", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      const color: mapboxgl.ExpressionSpecification = ["match", ["get", "tier"], 1, "#d5ad4d", 2, "#ef793d", 3, "#d84879", "#d5ad4d"]
      map.addLayer({ id: "codeblack-potential-fill", type: "fill", source: "codeblack-tornado-potential", paint: {
        "fill-color": color, "fill-opacity": .43 } })
      map.addLayer({ id: "codeblack-potential-outline", type: "line", source: "codeblack-tornado-potential", paint: {
        "line-color": color, "line-opacity": .4, "line-width": .5 } })
      update()
    })
    map.on("click", "codeblack-potential-fill", event => {
      const props = (event.features?.[0] as { properties?: Record<string, unknown> } | undefined)?.properties
      if (!props) return
      const element = document.createElement("div")
      element.style.cssText = "color:#17191f;font:12px/1.5 system-ui;max-width:240px"
      element.textContent = `${String(props.label).replaceAll("_", " ")} · index ${Number(props.index_mean).toFixed(2)}. ` +
        (props.storm_supported === true ? "Forecast convection overlaps." : "Conditional environment; forecast convection overlap is unconfirmed.")
      new mapboxgl.Popup().setLngLat(event.lngLat).setDOMContent(element).addTo(map)
    })
    map.on("error", () => setError("Some map tiles could not load."))
    return () => { mapRef.current = null; map.remove() }
  }, [])
  useEffect(update, [data, stormOnly])
  if (!hasMapboxToken()) return <p>Map token is unavailable in this build.</p>
  return <div className="potential-map-wrap"><div ref={container} className="potential-map" role="img" aria-label="Independent Code Black HRRR tornado environment screening map" />{error && <span className="potential-map-error">{error}</span>}</div>
}

export default function TornadoPotential() {
  const { config } = useCoreOps()
  const [data, setData] = useState<PotentialPayload | null>(null)
  const [frame, setFrame] = useState("")
  const [stormOnly, setStormOnly] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout>
    const load = async () => {
      setBusy(true)
      try {
        const response = parsePotential(await fetchForecast<unknown>(config,
          `tornado-potential${frame ? `?frame=${encodeURIComponent(frame)}` : ""}`, controller.signal))
        if (!controller.signal.aborted) { setData(response); setError("") }
      } catch {
        if (!controller.signal.aborted) setError("Potential-map source unavailable. Previous shading may be stale.")
      } finally {
        if (!controller.signal.aborted) { setBusy(false); timeout = setTimeout(() => void load(), 120000) }
      }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timeout) }
  }, [config, frame, refresh])
  return <div className="tornado-potential"><header className="potential-heading"><div><h2>Code Black tornado potential</h2><p>Forecast ingredients across CONUS · experimental environment screen</p></div><button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? "Updating…" : "Refresh"}</button></header>
    <div className="potential-controls"><label>Valid time <select value={frame || data?.frame_id || ""} onChange={event => setFrame(event.target.value)}>{data?.frames.map(item => <option key={item.frame_id} value={item.frame_id}>{time(item.valid_time)} · HRRR f{item.forecast_hour}</option>)}</select></label><label><input type="checkbox" checked={stormOnly} onChange={event => setStormOnly(event.target.checked)} /> Show only forecast convection overlap</label></div>
    {error && <p className="potential-warning" role="status">{error}</p>}
    {data?.status === "stale" && <p className="potential-warning" role="status">The published model layer is stale. Check source times before using it.</p>}
    {data?.status === "unavailable" && <p className="potential-warning">Complete model grids are unavailable. No tornado-potential assessment is shown.</p>}
    <PotentialMap data={data} stormOnly={stormOnly} />
    <div className="potential-legend"><span><i data-tier="1" />Conditional ingredients</span><span><i data-tier="2" />Elevated environment signal</span><span><i data-tier="3" />Strong environment signal</span></div>
    <div className="potential-metadata"><span>Run {time(data?.run_time)}</span><span>Valid {time(data?.valid_time)}</span><span>{data?.coverage ? `${data.coverage.native_land_points_evaluated.toLocaleString()} native land points evaluated · 0.25° display cells` : "Awaiting model coverage"}</span></div>
    <p className="potential-notice">{data?.notice ?? "This layer is being prepared from retained HRRR forecast grids."}</p>
    <section className="potential-aegis"><header><h3>Automatic Aegis setup reviews</h3><span>{data?.automatic_aegis?.status.replaceAll("_", " ") ?? "Awaiting first pass"}</span></header><p>Aegis reviews changed setup evidence and the nearby Code Black grid signal. <Link to="/analysis/drafts">Open setup reviews ↗</Link></p><div>{data?.automatic_aegis?.setups.map(setup => <article key={setup.setup_id}><strong>{setup.setup_id} · Revision {setup.revision}</strong><span>{setup.status.replaceAll("_", " ")}{setup.completed_at ? ` · ${time(setup.completed_at)}` : ""}</span><p>{setup.summary || (setup.status === "pending" ? "Aegis is reviewing this setup." : "Awaiting a successful automatic review.")}</p></article>)}</div></section>
  </div>
}
