import type { Map } from "mapbox-gl";
import type { AtlasCameraMode, AtlasGpsPoint } from "./types";

export function shortestAngleDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function smoothAngle(from: number, to: number, factor: number) {
  return (from + shortestAngleDelta(from, to) * factor + 360) % 360;
}

// The compact Weather-page card shows the wide-area mosaic, not single-site chase radar -- it
// should sit at a fixed regional zoom that reads the mosaic tiles crisply (their maxzoom is 7, see
// AtlasMosaicLayer.ts) rather than tracking vehicle speed down to a local street-level chase zoom.
const MOSAIC_CARD_ZOOM = 6.5;

export function zoomForSpeed(speedMph: number | null | undefined, expanded: boolean, compact = false) {
  if (compact) return MOSAIC_CARD_ZOOM;
  const speed = speedMph ?? 0;
  if (speed < 5) return expanded ? 9.2 : 8.2;
  if (speed < 35) return expanded ? 8.8 : 7.95;
  if (speed < 65) return expanded ? 8.35 : 7.55;
  return expanded ? 8.0 : 7.25;
}

export function applyAtlasCamera(
  map: Map,
  gps: AtlasGpsPoint,
  mode: AtlasCameraMode,
  expanded: boolean,
  previousBearing: number,
  compact = false,
) {
  const moving = (gps.speedMph ?? 0) >= 4 && gps.headingDeg != null;
  const targetZoom = zoomForSpeed(gps.speedMph, expanded, compact);
  const targetBearing = mode === "FOLLOW_HEADING" && moving ? gps.headingDeg ?? previousBearing : 0;
  const bearing = mode === "FOLLOW_HEADING" ? smoothAngle(previousBearing, targetBearing, 0.22) : targetBearing;
  const pitch = mode === "FOLLOW_HEADING" && moving ? 18 : 0;
  const padding = mode === "FOLLOW_HEADING"
    ? { top: 36, right: expanded ? 420 : 20, bottom: expanded ? 260 : 110, left: 20 }
    : { top: 20, right: expanded ? 380 : 20, bottom: 20, left: 20 };

  map.easeTo({
    center: [gps.lon, gps.lat],
    zoom: targetZoom,
    bearing,
    pitch,
    padding,
    duration: mode === "RECENTERING" ? 900 : 520,
    easing: (t) => 1 - (1 - t) ** 3,
    essential: true,
  });

  return { bearing, pitch, zoom: targetZoom };
}
