import { useEffect, useRef, useId } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken } from "../../../../src/services/mapTiles"
import { PEA_RIDGE_REFERENCE } from "../core/referenceLocation"
import type { TornadoTrackingMap } from "../pages/ChaseSetups"

export interface SetupCandidatePoint { latitude?: number; longitude?: number; valid_time?: string; run_time?: string; score_index?: number }
type Props = { geometry: unknown; trackingMap?: TornadoTrackingMap; bounds: number[] | undefined; points: SetupCandidatePoint[]; selectedKey?: string | null }

function validPoint(point: SetupCandidatePoint) {
  return typeof point.latitude === "number" && typeof point.longitude === "number" && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
}

export function SetupTargetMap({ geometry, trackingMap, bounds, points, selectedKey }: Props) {
  const descriptionId = useId()
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<InstanceType<typeof mapboxgl.Map> | null>(null)
  useEffect(() => {
    if (!container.current || !hasMapboxToken()) return
    mapboxgl.accessToken = mapboxAccessToken()
    const validBounds = bounds?.length === 4 && bounds.every(Number.isFinite) && bounds[0] < bounds[2] && bounds[1] < bounds[3]
    const center: [number, number] = validBounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : [PEA_RIDGE_REFERENCE.lon, PEA_RIDGE_REFERENCE.lat]
    const map = new mapboxgl.Map({ container: container.current, style: atlasStyleUri(), center, zoom: 4.5, attributionControl: false })
    mapRef.current = map
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right")
    map.on("load", () => {
      const tracked = trackingMap?.schema === "codeblack.chase.tornado-tracking-map.v1" && trackingMap.features?.length
      if (tracked || (geometry && typeof geometry === "object" && ["Polygon", "MultiPolygon"].includes((geometry as { type?: string }).type ?? ""))) {
        const data = tracked ? { type: "FeatureCollection", features: trackingMap.features } : { type: "Feature", properties: { official_risk_code: 2 }, geometry }
        map.addSource("setup-official-area", { type: "geojson", data: data as mapboxgl.GeoJSONSourceSpecification["data"] })
        const color: mapboxgl.ExpressionSpecification = ["step", ["get", "official_risk_code"], "#e6b653", 5, "#e87840", 10, "#df4e52", 15, "#b73b81"]
        map.addLayer({ id: "setup-official-fill", type: "fill", source: "setup-official-area", paint: { "fill-color": color, "fill-opacity": 0.18 } })
        map.addLayer({ id: "setup-official-outline", type: "line", source: "setup-official-area", paint: { "line-color": color, "line-width": 2 } })
      }
      const features = points.filter(validPoint).map((point, index) => ({ type: "Feature" as const, properties: { index: index + 1, key: `${point.latitude!.toFixed(5)},${point.longitude!.toFixed(5)},${point.valid_time ?? ""},${point.run_time ?? ""}` }, geometry: { type: "Point" as const, coordinates: [point.longitude!, point.latitude!] } }))
      map.addSource("setup-screening-points", { type: "geojson", data: { type: "FeatureCollection", features } })
      map.addLayer({ id: "setup-screening-halo", type: "circle", source: "setup-screening-points", paint: { "circle-color": "#ffcb53", "circle-opacity": 0.2, "circle-radius": 11 } })
      map.addLayer({ id: "setup-screening-dot", type: "circle", source: "setup-screening-points", paint: { "circle-color": "#ffcb53", "circle-stroke-color": "#211500", "circle-stroke-width": 1.5, "circle-radius": 4 } })
      map.addLayer({ id: "setup-screening-selected", type: "circle", source: "setup-screening-points", filter: ["==", ["get", "key"], ""], paint: { "circle-color": "#fff0bd", "circle-stroke-color": "#ffcb53", "circle-stroke-width": 3, "circle-radius": 9 } })
      if (validBounds) map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 18, duration: 0, maxZoom: 8 })
    })
    return () => { mapRef.current = null; map.remove() }
  }, [geometry, trackingMap, bounds, points])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const update = () => {
      if (!map.getLayer("setup-screening-selected")) return
      map.setFilter("setup-screening-selected", ["==", ["get", "key"], selectedKey ?? ""])
      const point = selectedKey ? points.find((candidate) => validPoint(candidate) && `${candidate.latitude!.toFixed(5)},${candidate.longitude!.toFixed(5)},${candidate.valid_time ?? ""},${candidate.run_time ?? ""}` === selectedKey) : null
      if (point) map.flyTo({ center: [point.longitude!, point.latitude!], zoom: 7, duration: 500 })
    }
    if (map.isStyleLoaded()) update()
    map.on("load", update)
    return () => { map.off("load", update) }
  }, [points, selectedKey])

  if (!hasMapboxToken()) return <div className="setup-target-map__unavailable">Mapbox is not configured in this build.</div>
  return <><div ref={container} className="setup-target-map" aria-describedby={descriptionId} /><span id={descriptionId} className="a11y-caption">Official SPC tornado outlook areas with Code Black model context and experimental HRRR screening points</span></>
}
