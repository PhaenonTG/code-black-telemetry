import type { Map, RasterSourceSpecification } from "mapbox-gl";
import { incrementAtlasCounter } from "./AtlasDiagnostics";

const MOSAIC_SOURCE_ID = "atlas-mosaic-nexrad";
const MOSAIC_LAYER_ID = "atlas-mosaic-nexrad-raster";
const MOSAIC_OPACITY = 0.6;

// Observed, not assumed: "ready" only after this source actually reports a completed tile load;
// "unavailable" only after a real tile request error; "stale" only once we've had a real success
// but it's aged past a couple of refresh cycles without a newer one. Never fabricated.
export type MosaicStatus = "loading" | "ready" | "stale" | "unavailable";

// Replaces the earlier RainViewer-backed animated frame loop (multi-layer frame cycling, prefetch
// sweeps, pause-during-interaction bookkeeping) -- that machinery was the single most bug-prone
// piece of this app across the whole project (choppy playback, sometimes not rendering at all,
// fighting the compact card's zoom cycling for the main thread) despite repeated fixes. Owner opted
// to trade the animated "storm crawling across the screen" loop for a single sharp auto-refreshing
// frame from a better source instead -- see the URL comment below. A real animated loop on this
// same NEXRAD source is a possible future addition (no documented public per-timestamp tile
// endpoint was found for it in this pass), tracked separately rather than blocking this swap.
//
// Iowa Environmental Mesonet (mesonet.agron.iastate.edu) publishes a free, no-key, CORS-open
// NEXRAD CONUS composite -- actual radar-derived mosaic at ~1km native resolution, regenerated
// every 5 minutes since 2003 (see mesonet.agron.iastate.edu/docs/nexrad_mosaic/), a meaningfully
// sharper and fresher source than RainViewer's globally-normalized product, which also hard-caps
// its own tile service at zoom 7 -- this app operates at zoom ~7.25-9.2, past that cap. Confirmed
// live via direct tile fetch that this endpoint serves clean tiles at zoom 10 with no error
// placeholder, so no equivalent maxzoom restriction is needed here.
//
// The "900913" path segment is the (deprecated but still Google-Maps-era-standard) EPSG code for
// Web Mercator that this tile service expects, not a frame selector -- this URL always serves
// whichever composite is currently latest. Mapbox's tile cache has no way to know the underlying
// image changed since the URL template itself never changes, so a coarse (REFRESH_MS-bucketed)
// cache-busting query param is added on each scheduled refresh to force a refetch.
const TILE_URL_BASE = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png";
const REFRESH_MS = 3 * 60_000; // Source data itself updates every 5 min; refresh a bit ahead of that.

function tileUrlForBucket(bucket: number) {
  return [`${TILE_URL_BASE}?v=${bucket}`];
}

function currentBucket() {
  return Math.floor(Date.now() / REFRESH_MS);
}

function ensureAtlasMosaicLayer(map: Map, beforeLayerId?: string) {
  if (!map.getSource(MOSAIC_SOURCE_ID)) {
    map.addSource(MOSAIC_SOURCE_ID, {
      type: "raster",
      tiles: tileUrlForBucket(currentBucket()),
      tileSize: 256,
    } satisfies RasterSourceSpecification);
    incrementAtlasCounter("sourceCreations");
  }
  if (!map.getLayer(MOSAIC_LAYER_ID)) {
    map.addLayer(
      {
        id: MOSAIC_LAYER_ID,
        type: "raster",
        source: MOSAIC_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "raster-opacity": MOSAIC_OPACITY, "raster-fade-duration": 300 },
      },
      beforeLayerId,
    );
    incrementAtlasCounter("layerCreations");
  }
}

function teardownAtlasMosaicLayer(map: Map) {
  if (map.getLayer(MOSAIC_LAYER_ID)) map.removeLayer(MOSAIC_LAYER_ID);
  if (map.getSource(MOSAIC_SOURCE_ID)) map.removeSource(MOSAIC_SOURCE_ID);
}

// A real tile source has aged past two refresh cycles with no newer success -- still showing the
// last frame, but honestly no longer confirmed current.
const STALE_AFTER_MS = REFRESH_MS * 2.5;

// Started once per map instance rather than driven by a React effect keyed on frequently-changing
// props -- the refresh cadence is time-based, not data- or prop-driven, so it doesn't need to react
// to renders at all once running.
export function startAtlasMosaicLayer(
  map: Map,
  isVisible: () => boolean,
  beforeLayerId?: string,
  onStatus?: (status: MosaicStatus) => void,
): () => void {
  ensureAtlasMosaicLayer(map, beforeLayerId);
  let lastBucket = currentBucket();
  let lastSuccessAt: number | null = null;
  let current: MosaicStatus = "loading";

  const report = (status: MosaicStatus) => {
    if (status === current) return;
    current = status;
    onStatus?.(status);
  };

  const handleData = (event: { sourceId?: string; dataType?: string; isSourceLoaded?: boolean }) => {
    if (event.sourceId !== MOSAIC_SOURCE_ID || event.dataType !== "source") return;
    if (event.isSourceLoaded) {
      lastSuccessAt = Date.now();
      report("ready");
    }
  };
  const handleError = (event: { sourceId?: string }) => {
    if (event.sourceId !== MOSAIC_SOURCE_ID) return;
    report("unavailable");
  };
  map.on("data", handleData as never);
  map.on("error", handleError as never);

  const tick = () => {
    if (!map.getLayer(MOSAIC_LAYER_ID)) return;
    map.setLayoutProperty(MOSAIC_LAYER_ID, "visibility", isVisible() ? "visible" : "none");
    const bucket = currentBucket();
    if (bucket !== lastBucket) {
      lastBucket = bucket;
      const source = map.getSource(MOSAIC_SOURCE_ID);
      if (source && source.type === "raster") source.setTiles(tileUrlForBucket(bucket));
    }
    if (lastSuccessAt !== null && current === "ready" && Date.now() - lastSuccessAt > STALE_AFTER_MS) {
      report("stale");
    }
  };

  tick();
  const timer = window.setInterval(tick, 2000);
  return () => {
    window.clearInterval(timer);
    map.off("data", handleData as never);
    map.off("error", handleError as never);
    teardownAtlasMosaicLayer(map);
  };
}
