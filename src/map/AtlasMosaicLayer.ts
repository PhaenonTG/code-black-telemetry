import type { Map } from "mapbox-gl";
import { ATLAS_RADAR_LAYER } from "./AtlasRadarLayer";
import { incrementAtlasCounter } from "./AtlasDiagnostics";

const ATLAS_MOSAIC_SOURCE = "atlas-mosaic-tiles";
const ATLAS_MOSAIC_LAYER = "atlas-mosaic-raster";
const MOSAIC_OPACITY = 0.6;
// RainViewer's tile service only generates radar tiles up to z7 (documented max); this app's map
// normally operates at z7.25-9.2. Without maxzoom, Mapbox requests tiles past what RainViewer has
// and gets back a "Zoom level not supported" placeholder image instead of radar data. Setting
// maxzoom here tells Mapbox to stop requesting past z7 and over-zoom (upscale) that tile instead --
// standard raster-source behavior, not a workaround.
const MOSAIC_MAX_ZOOM = 7;

// Wide-area situational-awareness context, not the primary radar -- deliberately never inserted
// above the tuned single-site view. Checking for ATLAS_RADAR_LAYER at call time (rather than
// always targeting the same beforeLayerId as it does) means the z-order comes out correct
// regardless of which layer happens to get created first: if the radar layer already exists,
// insert directly below it; otherwise fall back to sitting below the base style's labels, and let
// the radar layer's own insertion (always targeting the symbol layer) naturally end up above this
// one whenever it's created afterward.
export function updateAtlasMosaicLayer(map: Map, tileTemplate: string | null, visible: boolean, firstSymbolLayerId?: string) {
  if (!visible || !tileTemplate) {
    if (map.getLayer(ATLAS_MOSAIC_LAYER)) map.setLayoutProperty(ATLAS_MOSAIC_LAYER, "visibility", "none");
    return;
  }

  if (!map.getSource(ATLAS_MOSAIC_SOURCE)) {
    map.addSource(ATLAS_MOSAIC_SOURCE, { type: "raster", tiles: [tileTemplate], tileSize: 256, maxzoom: MOSAIC_MAX_ZOOM });
    incrementAtlasCounter("sourceCreations");
  }

  if (!map.getLayer(ATLAS_MOSAIC_LAYER)) {
    const beforeLayerId = map.getLayer(ATLAS_RADAR_LAYER) ? ATLAS_RADAR_LAYER : firstSymbolLayerId;
    map.addLayer({
      id: ATLAS_MOSAIC_LAYER,
      type: "raster",
      source: ATLAS_MOSAIC_SOURCE,
      paint: { "raster-opacity": MOSAIC_OPACITY, "raster-fade-duration": 180 },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  } else {
    map.setLayoutProperty(ATLAS_MOSAIC_LAYER, "visibility", "visible");
  }
}
