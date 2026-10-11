import type { TrafficCamera } from "./mapLayerModels";
import type { MapPinStatus } from "./mapSourceRegistry";

// Source records stay available to provider diagnostics and the next audit. This gate
// controls only whether a camera is advertised as a usable map pin.
export const CAMERA_MAP_REVIEW_DATE = "2026-11-10";

export const CAMERA_MAP_SUPPRESSIONS: Record<string, string> = {
  // Oct 11 visual audit: live image is nearly all pavement/gantry, with no useful sky.
  "iadot-511:camera:59634486": "I-35 MM 140 Williams RWIS: road/gantry view, negligible sky",
  "tdot-smartway:camera:3165": "I-40/75 West Hills: roadway fills frame, negligible sky",
  "modot-traveler:camera:1000": "MO 13/Norton: advertised HLS stream returned 404 on Oct 11",
  "modot-traveler:camera:1001": "Chestnut/Pythian: live stream points down at pavement, no sky",
};

export function cameraMapEligibility(camera: TrafficCamera, reviewStatus?: MapPinStatus): { eligible: boolean; reason: string | null } {
  const reason = (reviewStatus === "hidden" ? "Hidden by operator review" : null)
    ?? (reviewStatus === "needs_review" ? "Pending operator review" : null)
    ?? (reviewStatus === "visible" ? null : CAMERA_MAP_SUPPRESSIONS[camera.id])
    ?? camera.mapDisabledReason
    ?? ((camera as TrafficCamera & { stale?: boolean }).stale ? "Cached provider data" : null)
    ?? (camera.availability === "offline" || camera.availability === "stale" ? `Provider reports ${camera.availability}` : null)
    // Iowa's ArcGIS row-update timestamp can lag even when the JPEG itself is current;
    // its sampled image was fresh on Oct 11 despite an Oct 8 row timestamp.
    ?? (camera.providerId !== "iadot-511" && (camera.freshness === "stale" || camera.freshness === "unavailable") ? "Stale camera feed" : null)
    ?? (!camera.streamUrl && !camera.imageUrl && !camera.previewUrl && !camera.thumbnailUrl ? "No playable media" : null);
  return { eligible: !reason, reason };
}
