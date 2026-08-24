import type { GeoJSONSource, Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { RoadConditionEvent } from "../services/mapLayerModels";
import { incrementAtlasCounter } from "./AtlasDiagnostics";
import { showPinPopup, type PinPoint } from "./AtlasPinMarkers";
import { roadEventToPin } from "./AtlasRoadLayer";

// Paints the actual road segment for closures/work zones whose provider gives real line geometry
// (KanDrive's route trace, ODOT's WZDx LineString, MoDOT's Line layers -- see roadCameraProviders.ts)
// instead of a single dot. Events without line geometry (ARDOT has none available at the source)
// still render as points via AtlasRoadLayer.ts -- AtlasMap.tsx splits the two before handing off.
const ATLAS_ROAD_LINES_SOURCE = "atlas-road-lines";
const ATLAS_ROAD_LINES_CASING_LAYER = "atlas-road-lines-casing";
const ATLAS_ROAD_LINES_LAYER = "atlas-road-lines-line";

const RED = "#ff2d35";
const AMBER = "#f4b623";
const ORANGE = "#ff7e30";

function toFeatureCollection(events: RoadConditionEvent[]) {
  return {
    type: "FeatureCollection",
    features: events
      .filter((event) => event.geometry.type === "line")
      .map((event) => ({
        type: "Feature",
        properties: { id: event.id, closureState: event.closureState, stale: event.stale },
        geometry: {
          type: "LineString",
          coordinates: (event.geometry as { type: "line"; coordinates: Array<{ lat: number; lon: number }> }).coordinates.map((point) => [point.lon, point.lat]),
        },
      })),
  };
}

const latestEventsById = new WeakMap<MapboxMap, Record<string, RoadConditionEvent>>();
const clickHandlerAttached = new WeakSet<MapboxMap>();

function attachClickHandler(map: MapboxMap) {
  if (clickHandlerAttached.has(map)) return;
  clickHandlerAttached.add(map);
  const handleClick = (event: MapMouseEvent) => {
    const features = event.features as Array<{ properties?: Record<string, unknown> }> | undefined;
    const id = features?.[0]?.properties?.id as string | undefined;
    if (!id) return;
    const roadEvent = latestEventsById.get(map)?.[id];
    if (!roadEvent) return;
    // Popup anchors where the road was actually clicked, not the segment's stored midpoint --
    // matches how a click on a long segment should feel (details for right here, not the segment's
    // far end).
    const point: PinPoint = { ...roadEventToPin(roadEvent), lat: event.lngLat.lat, lon: event.lngLat.lng };
    showPinPopup(map, point);
  };
  for (const layerId of [ATLAS_ROAD_LINES_LAYER, ATLAS_ROAD_LINES_CASING_LAYER]) {
    map.on("click", layerId, handleClick as (event: MapMouseEvent) => void);
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
  }
}

export function updateAtlasRoadLineLayer(map: MapboxMap, events: RoadConditionEvent[], visible: boolean, beforeLayerId?: string) {
  const collection = toFeatureCollection(events);
  latestEventsById.set(map, Object.fromEntries(events.map((event) => [event.id, event])));

  const source = map.getSource(ATLAS_ROAD_LINES_SOURCE) as GeoJSONSource | undefined;
  if (source) {
    source.setData(collection as never);
    incrementAtlasCounter("sourceUpdates");
  } else {
    map.addSource(ATLAS_ROAD_LINES_SOURCE, { type: "geojson", data: collection as never });
    incrementAtlasCounter("sourceCreations");
  }

  // Dark casing underneath the color line, same idea as a highlighted route on any consumer map --
  // keeps the line readable over bright radar returns and light basemap roads alike.
  if (!map.getLayer(ATLAS_ROAD_LINES_CASING_LAYER)) {
    map.addLayer({
      id: ATLAS_ROAD_LINES_CASING_LAYER,
      type: "line",
      source: ATLAS_ROAD_LINES_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#000000", "line-width": 7, "line-opacity": 0.45 },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  if (!map.getLayer(ATLAS_ROAD_LINES_LAYER)) {
    map.addLayer({
      id: ATLAS_ROAD_LINES_LAYER,
      type: "line",
      source: ATLAS_ROAD_LINES_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["match", ["get", "closureState"], "closed", RED, "lane-restricted", AMBER, ORANGE],
        "line-width": ["match", ["get", "closureState"], "closed", 5, 4],
        "line-opacity": ["case", ["==", ["get", "stale"], true], 0.4, 0.9],
      },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }

  attachClickHandler(map);

  const visibility = visible ? "visible" : "none";
  for (const layerId of [ATLAS_ROAD_LINES_CASING_LAYER, ATLAS_ROAD_LINES_LAYER]) {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  }
}
