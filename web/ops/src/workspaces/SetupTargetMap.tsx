import { useEffect, useRef } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken } from "../../../../src/services/mapTiles"

export interface SetupCandidatePoint { latitude?: number; longitude?: number; valid_time?: string; score_index?: number }
type Props = { geometry: unknown; bounds: number[] | undefined; points: SetupCandidatePoint[] }

function validPoint(point: SetupCandidatePoint) {
  return typeof point.latitude === "number" && typeof point.longitude === "number" && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
}

export function SetupTargetMap({ geometry, bounds, points }: Props) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!container.current || !hasMapboxToken()) return
    mapboxgl.accessToken = mapboxAccessToken()
    const validBounds = bounds?.length === 4 && bounds.every(Number.isFinite) && bounds[0] < bounds[2] && bounds[1] < bounds[3]
    const center: [number, number] = validBounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : [-95.6752, 39.0473]
    const map = new mapboxgl.Map({ container: container.current, style: atlasStyleUri(), center, zoom: 4.5, attributionControl: false })
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right")
    map.on("load", () => {
      if (geometry && typeof geometry === "object" && ["Polygon", "MultiPolygon"].includes((geometry as { type?: string }).type ?? "")) {
        map.addSource("setup-official-area", { type: "geojson", data: { type: "Feature", properties: {}, geometry } as mapboxgl.GeoJSONSourceSpecification["data"] })
        map.addLayer({ id: "setup-official-fill", type: "fill", source: "setup-official-area", paint: { "fill-color": "#e43b4a", "fill-opacity": 0.14 } })
        map.addLayer({ id: "setup-official-outline", type: "line", source: "setup-official-area", paint: { "line-color": "#f16a72", "line-width": 2 } })
      }
      const features = points.filter(validPoint).map((point, index) => ({ type: "Feature" as const, properties: { index: index + 1 }, geometry: { type: "Point" as const, coordinates: [point.longitude!, point.latitude!] } }))
      map.addSource("setup-screening-points", { type: "geojson", data: { type: "FeatureCollection", features } })
      map.addLayer({ id: "setup-screening-halo", type: "circle", source: "setup-screening-points", paint: { "circle-color": "#ffcb53", "circle-opacity": 0.2, "circle-radius": 11 } })
      map.addLayer({ id: "setup-screening-dot", type: "circle", source: "setup-screening-points", paint: { "circle-color": "#ffcb53", "circle-stroke-color": "#211500", "circle-stroke-width": 1.5, "circle-radius": 4 } })
      if (validBounds) map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 18, duration: 0, maxZoom: 8 })
    })
    return () => map.remove()
  }, [geometry, bounds, points])

  if (!hasMapboxToken()) return <div className="setup-target-map__unavailable">Mapbox is not configured in this build.</div>
  return <div ref={container} className="setup-target-map" role="img" aria-label="Official SPC risk area and experimental HRRR screening candidate points" />
}
