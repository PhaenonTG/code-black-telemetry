import type { Map, RasterTileSource } from "mapbox-gl";
import { ATLAS_RADAR_LAYER } from "./AtlasRadarLayer";
import { incrementAtlasCounter } from "./AtlasDiagnostics";

const ATLAS_MOSAIC_SOURCE = "atlas-mosaic-tiles";
const ATLAS_MOSAIC_LAYER = "atlas-mosaic-raster";
const MOSAIC_OPACITY = 0.6;
// RainViewer's tile service only generates radar tiles up to z7 (documented max); this app's map
// normally operates at z7.25-9.2. Without maxzoom, Mapbox requests tiles past what RainViewer has
// and gets back a "Zoom level not supported" placeholder image instead of radar data. Setting
// maxzoom here tells Mapbox to stop requesting past z7 and over-zoom (upscale) that tile instead --
// standard raster-source behavior, not a workaround. This has to survive every frame swap during
// the loop animation below, not just the initial source creation -- it's set once on the source
// itself (not per-tile-template), so `setTiles()` (which only replaces the tiles array) can't lose
// it.
const MOSAIC_MAX_ZOOM = 7;
const FRAME_INTERVAL_MS = 400; // Fast enough to read as motion, matching typical radar-loop apps.
const LOOP_COUNT = 3; // Play through the available history this many times per cycle.
const HOLD_MS = 20_000; // Then hold on the latest frame before the next cycle starts.

function ensureAtlasMosaicLayer(map: Map, firstSymbolLayerId?: string) {
  if (!map.getSource(ATLAS_MOSAIC_SOURCE)) {
    map.addSource(ATLAS_MOSAIC_SOURCE, { type: "raster", tiles: [], tileSize: 256, maxzoom: MOSAIC_MAX_ZOOM });
    incrementAtlasCounter("sourceCreations");
  }
  if (!map.getLayer(ATLAS_MOSAIC_LAYER)) {
    // Wide-area situational-awareness context, not the primary radar -- deliberately never
    // inserted above the tuned single-site view. Checking for ATLAS_RADAR_LAYER at call time
    // (rather than always targeting the same beforeLayerId) means the z-order comes out correct
    // regardless of which layer happens to get created first: if the radar layer already exists,
    // insert directly below it; otherwise fall back to sitting below the base style's labels, and
    // let the radar layer's own insertion (always targeting the symbol layer) naturally end up
    // above this one whenever it's created afterward.
    const beforeLayerId = map.getLayer(ATLAS_RADAR_LAYER) ? ATLAS_RADAR_LAYER : firstSymbolLayerId;
    map.addLayer({
      id: ATLAS_MOSAIC_LAYER,
      type: "raster",
      source: ATLAS_MOSAIC_SOURCE,
      layout: { visibility: "none" },
      paint: { "raster-opacity": MOSAIC_OPACITY, "raster-fade-duration": 180 },
    }, beforeLayerId);
    incrementAtlasCounter("layerCreations");
  }
}

function setAtlasMosaicFrame(map: Map, tileTemplate: string) {
  const source = map.getSource(ATLAS_MOSAIC_SOURCE) as RasterTileSource | undefined;
  source?.setTiles([tileTemplate]);
}

function setAtlasMosaicVisible(map: Map, visible: boolean) {
  if (map.getLayer(ATLAS_MOSAIC_LAYER)) {
    map.setLayoutProperty(ATLAS_MOSAIC_LAYER, "visibility", visible ? "visible" : "none");
  }
}

// Plays through the available frame history LOOP_COUNT times, then holds on the latest frame for
// HOLD_MS before repeating -- reads getFrames()/isVisible() fresh on every tick (rather than
// capturing them once) so the caller can refresh the frame list or toggle visibility at any time
// without having to restart this loop.
export function startAtlasMosaicAnimation(map: Map, getFrames: () => string[], isVisible: () => boolean, firstSymbolLayerId?: string): () => void {
  ensureAtlasMosaicLayer(map, firstSymbolLayerId);
  let timeoutId = 0;
  let stepCount = 0;
  let wasVisible = false;

  const tick = () => {
    const frames = getFrames();
    const visible = isVisible() && frames.length > 0;
    if (visible !== wasVisible) {
      setAtlasMosaicVisible(map, visible);
      wasVisible = visible;
    }
    if (!visible) {
      stepCount = 0;
      timeoutId = window.setTimeout(tick, 1000);
      return;
    }

    const frameIndex = stepCount % frames.length;
    setAtlasMosaicFrame(map, frames[frameIndex]);
    stepCount += 1;

    const justFinishedLoops = stepCount >= frames.length * LOOP_COUNT;
    if (justFinishedLoops) {
      stepCount = 0;
      timeoutId = window.setTimeout(tick, HOLD_MS);
    } else {
      timeoutId = window.setTimeout(tick, FRAME_INTERVAL_MS);
    }
  };

  tick();
  return () => window.clearTimeout(timeoutId);
}
