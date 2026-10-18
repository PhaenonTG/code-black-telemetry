import { useEffect, useMemo, useRef } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import { atlasStyleUri, hasMapboxToken, mapboxAccessToken } from "../../../../src/services/mapTiles"
import { tuneAtlasStyle } from "../../../../src/map/AtlasStyleManager"
import type { FabricUnitState } from "../../../../src/services/fabric"
import { locationPoint, liveChaserPoint, PEA_RIDGE_REFERENCE } from "../core/referenceLocation"

type Point = { lat: number; lon: number }

function unitPoint(unit: FabricUnitState): Point | null {
  return liveChaserPoint(unit) ?? locationPoint(unit.location)
}

export function ProducerSituationMap({ selectedPoint, units, onPointSelect }: { selectedPoint: Point | null; units: FabricUnitState[]; onPointSelect: (point: Point) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<InstanceType<typeof mapboxgl.Map> | null>(null)
  const fittedUnits = useRef(false)
  const onPointSelectRef = useRef(onPointSelect)
  onPointSelectRef.current = onPointSelect
  const positions = useMemo(() => units.flatMap((unit) => {
    const point = unitPoint(unit)
    return point ? [{ id: unit.unit_id, name: unit.operator_name || unit.display_name, point, online: Boolean(liveChaserPoint(unit)) }] : []
  }), [units])
  const selectedLat = selectedPoint?.lat
  const selectedLon = selectedPoint?.lon
  const hasSelectedPoint = selectedLat != null && selectedLon != null
  const center = selectedPoint ?? positions[0]?.point ?? PEA_RIDGE_REFERENCE

  useEffect(() => {
    if (!container.current || !hasMapboxToken()) return
    mapboxgl.accessToken = mapboxAccessToken()
    const instance = new mapboxgl.Map({ container: container.current, style: atlasStyleUri(), center: [center.lon, center.lat], zoom: selectedPoint ? 7 : positions.length ? 6 : 4.5, attributionControl: false })
    map.current = instance
    instance.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right")
    instance.on("style.load", () => tuneAtlasStyle(instance as unknown as Parameters<typeof tuneAtlasStyle>[0]))
    instance.on("click", (event) => onPointSelectRef.current({ lat: event.lngLat.lat, lon: event.lngLat.lng }))
    return () => { map.current = null; instance.remove() }
    // Create a single WebGL map; later position updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const markers: InstanceType<typeof mapboxgl.Marker>[] = []
    for (const item of positions) {
      const element = document.createElement("div")
      element.className = item.online ? "producer-map__unit" : "producer-map__unit producer-map__unit--offline"
      element.textContent = item.name
      element.title = `${item.name} · ${item.online ? "GPS reporting" : "last known position · no fresh GPS"}`
      markers.push(new mapboxgl.Marker({ element }).setLngLat([item.point.lon, item.point.lat]).addTo(instance))
    }
    if (!hasSelectedPoint && positions.length && !fittedUnits.current) {
      const bounds = new mapboxgl.LngLatBounds()
      positions.forEach((item) => bounds.extend([item.point.lon, item.point.lat]))
      if (positions.length === 1) instance.easeTo({ center: [positions[0].point.lon, positions[0].point.lat], zoom: 7, duration: 350 })
      else instance.fitBounds(bounds, { padding: 48, maxZoom: 8, duration: 350 })
      fittedUnits.current = true
    }
    return () => markers.forEach((marker) => marker.remove())
  }, [positions, hasSelectedPoint])

  useEffect(() => {
    const instance = map.current
    if (!instance || selectedLat == null || selectedLon == null) return
    const element = document.createElement("div")
    element.className = "producer-map__selected"
    element.title = "Selected alert point"
    const marker = new mapboxgl.Marker({ element }).setLngLat([selectedLon, selectedLat]).addTo(instance)
    instance.easeTo({ center: [selectedLon, selectedLat], duration: 350 })
    return () => { marker.remove() }
  }, [selectedLat, selectedLon])

  if (!hasMapboxToken()) return <div className="producer-map__unavailable">Mapbox is not configured in this build. Open Operations Map for the full situation display.</div>
  return <div ref={container} className="producer-map" role="application" aria-label="Producer situation map; select a point for official alerts" />
}
