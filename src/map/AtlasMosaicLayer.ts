import type { Map } from "mapbox-gl";
import { ATLAS_RADAR_LAYER } from "./AtlasRadarLayer";
import { incrementAtlasCounter } from "./AtlasDiagnostics";

const MOSAIC_SOURCE_PREFIX = "atlas-mosaic-tiles-";
const MOSAIC_LAYER_PREFIX = "atlas-mosaic-raster-";
const MOSAIC_OPACITY = 0.6;
// RainViewer's tile service only generates radar tiles up to z7 (documented max); this app's map
// normally operates at z7.25-9.2. Without maxzoom, Mapbox requests tiles past what RainViewer has
// and gets back a "Zoom level not supported" placeholder image instead of radar data.
const MOSAIC_MAX_ZOOM = 7;
const FRAME_INTERVAL_MS = 500; // Fast enough to read as motion, matching typical radar-loop apps.
const LOOP_COUNT = 3; // Play through the available history this many times per cycle.
const HOLD_MS = 20_000; // Then hold on the latest frame before the next cycle starts.

function frameSourceId(index: number) {
  return `${MOSAIC_SOURCE_PREFIX}${index}`;
}

function frameLayerId(index: number) {
  return `${MOSAIC_LAYER_PREFIX}${index}`;
}

// Each historical frame gets its own permanent source+layer instead of one shared source whose
// tile URLs get mutated every animation tick. Confirmed live that repeatedly calling setTiles() on
// a single raster source every ~400ms did not reliably force Mapbox to refetch/repaint -- its tile
// cache is keyed by z/x/y coordinate, not by which "generation" of the source's URL template
// produced the cached image, so the visible frame only actually changed when some OTHER map event
// (a user pan/zoom) forced a full tile reload anyway. That's exactly what "animation only moves
// when I move the map" was describing. Pre-creating one real layer per frame and toggling
// visibility (the same mechanism every other layer in this app already uses for on/off state) is
// instant and network-independent once each frame's tiles have loaded once.
function ensureAtlasMosaicFrameLayers(map: Map, urls: string[], firstSymbolLayerId?: string) {
  const beforeLayerId = map.getLayer(ATLAS_RADAR_LAYER) ? ATLAS_RADAR_LAYER : firstSymbolLayerId;
  urls.forEach((url, index) => {
    const sourceId = frameSourceId(index);
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "raster", tiles: [url], tileSize: 256, maxzoom: MOSAIC_MAX_ZOOM });
      incrementAtlasCounter("sourceCreations");
    }
    const layerId = frameLayerId(index);
    if (!map.getLayer(layerId)) {
      map.addLayer(
        {
          id: layerId,
          type: "raster",
          source: sourceId,
          layout: { visibility: "none" },
          paint: { "raster-opacity": MOSAIC_OPACITY, "raster-fade-duration": 0 },
        },
        beforeLayerId,
      );
      incrementAtlasCounter("layerCreations");
    }
  });
}

function teardownAtlasMosaicFrameLayers(map: Map, count: number) {
  for (let i = 0; i < count; i += 1) {
    if (map.getLayer(frameLayerId(i))) map.removeLayer(frameLayerId(i));
    if (map.getSource(frameSourceId(i))) map.removeSource(frameSourceId(i));
  }
}

function setActiveFrame(map: Map, count: number, activeIndex: number | null) {
  for (let i = 0; i < count; i += 1) {
    if (!map.getLayer(frameLayerId(i))) continue;
    map.setLayoutProperty(frameLayerId(i), "visibility", i === activeIndex ? "visible" : "none");
  }
}

function sameUrls(a: string[], b: string[]) {
  return a.length === b.length && a.every((url, index) => url === b[index]);
}

// Plays through the available frame history LOOP_COUNT times, then holds on the latest frame for
// HOLD_MS before repeating. Reads getFrames()/isVisible()/isPaused() fresh on every tick (rather
// than capturing them once) so the caller can refresh the frame list, toggle visibility, or pause
// for manual map interaction at any time without having to restart this loop.
export function startAtlasMosaicAnimation(
  map: Map,
  getFrames: () => string[],
  isVisible: () => boolean,
  firstSymbolLayerId?: string,
  isPaused: () => boolean = () => false,
): () => void {
  let timeoutId = 0;
  let stepCount = 0;
  let builtUrls: string[] = [];

  const rebuildIfNeeded = (urls: string[]) => {
    if (sameUrls(urls, builtUrls)) return;
    teardownAtlasMosaicFrameLayers(map, builtUrls.length);
    ensureAtlasMosaicFrameLayers(map, urls, firstSymbolLayerId);
    builtUrls = urls;
    stepCount = 0;
  };

  const tick = () => {
    const frames = getFrames();
    const visible = isVisible() && frames.length > 0;
    rebuildIfNeeded(frames);

    if (!visible) {
      setActiveFrame(map, builtUrls.length, null);
      stepCount = 0;
      timeoutId = window.setTimeout(tick, 1000);
      return;
    }

    // Paused for manual map interaction: keep whatever frame is already showing (don't reset to
    // frame 0) so a resumed loop continues from a sensible point, and check back soon rather than
    // committing to a long HOLD_MS wait that would outlast the pause.
    if (isPaused()) {
      timeoutId = window.setTimeout(tick, 1000);
      return;
    }

    const frameIndex = stepCount % frames.length;
    setActiveFrame(map, builtUrls.length, frameIndex);
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
  return () => {
    window.clearTimeout(timeoutId);
    teardownAtlasMosaicFrameLayers(map, builtUrls.length);
  };
}
