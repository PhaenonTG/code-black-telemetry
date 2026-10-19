import { useEffect, useId, useRef, useState } from "react"
import { Link } from "react-router-dom"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken } from "../../../../src/services/mapTiles"
import { fetchForecast } from "../core/client"
import { useCoreOps } from "../core/useCoreOps"
import { parsePotential, type PotentialPayload } from "../workspaces/tornadoPotentialModel"
import { SetupReviewTitle } from "./SetupReviewTitle"
import { AsyncViewState, ErrorState } from "../components/AsyncViewState"
import { formatOpsTimestamp } from "../core/timeFormat"
import { nextPotentialFrame } from "./SetupReviewModel"
import "./TornadoPotential.css"

const time = (value?: string) => value && Number.isFinite(Date.parse(value)) ? <time dateTime={value} title={new Date(value).toISOString()}>{formatOpsTimestamp(value)}</time> : "\u2014"

export function PotentialMap({ data, stormOnly }: { data: PotentialPayload | null; stormOnly: boolean }) {
  const descriptionId = useId()
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
  return <div className="potential-map-wrap"><div ref={container} className="potential-map" aria-describedby={descriptionId} /><span id={descriptionId} className="a11y-caption">Independent Code Black HRRR tornado environment screening map</span>{error && <span className="potential-map-error">{error}</span>}</div>
}

export default function TornadoPotential() {
  const { config } = useCoreOps()
  const [data, setData] = useState<PotentialPayload | null>(null)
  const [now, setNow] = useState(() => Date.now())
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
        if (!controller.signal.aborted) {
          setData(response); setNow(Date.now()); setError("");
          if (!frame) { const next = nextPotentialFrame(response.frames); if (next) setFrame(next.frame_id); }
        }
      } catch {
        if (!controller.signal.aborted) setError("The model grid could not be checked. Previous shading may be stale; this is not an all-clear.")
      } finally {
        if (!controller.signal.aborted) { setBusy(false); timeout = setTimeout(() => void load(), 120000) }
      }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timeout) }
  }, [config, frame, refresh])
  const frames = data?.frames ?? []
  const selectedIndex = frames.findIndex(item => item.frame_id === (frame || data?.frame_id))
  const selectedFrame = frames[selectedIndex]
  const unavailable = Boolean(error || data?.status === "unavailable")
  const stale = data?.status === "stale" || data?.status.includes("degraded")
  return <div className="tornado-potential">
    <SetupReviewTitle title="Potential" description="Independent forecast-grid screening · this is not an all-clear."
      state={unavailable ? "Unavailable" : !data ? "Waiting" : stale ? "Stale" : "Live"}
      checkedAt={data?.generated_at} busy={busy} refresh={() => setRefresh(value => value + 1)} reloads="the model grid and setup reviews">
      <span className="analysis-experimental">Experimental</span>
    </SetupReviewTitle>
    <div className="potential-controls">
      <div className="analysis-time-stepper" role="group" aria-label="Valid time">
        <button type="button" aria-label="Previous valid hour" disabled={selectedIndex <= 0} onClick={() => setFrame(frames[selectedIndex - 1].frame_id)}>−1 h</button>
        <span>Valid {time(selectedFrame?.valid_time ?? data?.valid_time)} · Run {time(selectedFrame?.run_time ?? data?.run_time)}</span>
        <button type="button" aria-label="Next valid hour" disabled={selectedIndex < 0 || selectedIndex >= frames.length - 1} onClick={() => setFrame(frames[selectedIndex + 1].frame_id)}>+1 h</button>
        <details><summary>Choose any hour</summary><label>Valid time <select disabled={!frames.length} value={frame || data?.frame_id || ""} onChange={event => setFrame(event.target.value)}>{frames.map(item => <option key={item.frame_id} value={item.frame_id}>{formatOpsTimestamp(item.valid_time)} · HRRR f{item.forecast_hour}{Date.parse(item.valid_time) < now ? " (past)" : ""}</option>)}</select></label></details>
      </div>
      <label><input type="checkbox" checked={stormOnly} onChange={event => setStormOnly(event.target.checked)} /> Show only forecast convection overlap</label>
    </div>
    {!data && !error && <AsyncViewState state="loading" title="Waiting for model grid" />}
    {unavailable && <ErrorState title="Model grid unavailable" message={error || "Complete model grids are unavailable. No tornado-potential assessment is shown."} onRetry={() => setRefresh(value => value + 1)} />}
    {stale && !unavailable && <p className="potential-warning" role="status">The published model layer is stale. Check source times before using it.</p>}
    {data && !unavailable && !data.features.some(feature => !stormOnly || feature.properties.storm_supported === true) && <p role="status">No shaded cells for this hour; this is not an all-clear</p>}
    <PotentialMap data={data} stormOnly={stormOnly} />
    <div className="potential-legend"><span><i data-tier="1" />Conditional ingredients</span><span><i data-tier="2" />Elevated environment signal</span><span><i data-tier="3" />Strong environment signal</span></div>
    <div className="potential-metadata"><span>{data?.coverage ? `${data.coverage.native_land_points_evaluated.toLocaleString()} native land points evaluated · 0.25° display cells` : "Awaiting model coverage"}</span></div>
    <p className="potential-notice">{data?.notice ?? "This layer is being prepared from retained HRRR forecast grids."}</p>
    <section className="potential-aegis"><header><h3>Automatic Aegis setup reviews</h3><span>{data?.automatic_aegis?.status.replaceAll("_", " ") ?? "Awaiting first pass"}</span></header><p>Aegis reviews changed setup evidence and the nearby Code Black grid signal. <Link to="/setup-review/drafts">Open setup reviews →</Link></p><div>{data?.automatic_aegis?.setups.map(setup => <article key={setup.setup_id}><strong>{setup.setup_id} · Revision {setup.revision}</strong><span>{setup.status.replaceAll("_", " ")}{setup.completed_at && <> · {time(setup.completed_at)}</>}</span><p>{setup.summary || (setup.status === "pending" ? "Aegis is reviewing this setup." : "Awaiting a successful automatic review.")}</p>{!setup.summary && setup.previous_summary && <p><strong>Previous review · Revision {setup.previous_revision}</strong>{setup.previous_summary}</p>}</article>)}</div></section>
  </div>
}
