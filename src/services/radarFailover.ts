import type { RadarFrame } from "./radar";

export const RADAR_FAILOVER_MAX_AGE_SECONDS = 18 * 60;

export function radarFramesAreOperational(frames: RadarFrame[], maxAgeSeconds = RADAR_FAILOVER_MAX_AGE_SECONDS) {
  const newest = frames[0];
  if (!newest) return false;
  return newest.ageSeconds <= maxAgeSeconds && !["STALE", "OFFLINE", "SITE DOWN", "INCOMPLETE"].includes(newest.freshness);
}

export function radarFailoverReason(frames: RadarFrame[]) {
  const newest = frames[0];
  if (!newest) return "PRIMARY UNAVAILABLE";
  if (newest.freshness === "INCOMPLETE") return "PRIMARY INCOMPLETE";
  return `PRIMARY ${Math.max(0, Math.round(newest.ageSeconds / 60))}M OLD`;
}
