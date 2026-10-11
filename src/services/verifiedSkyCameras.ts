import type { LayerQueryContext, TrafficCamera } from "./mapLayerModels";

// Public, provider-sanctioned embed. The Oct 11 audit verified the marina address,
// a useful sky/water view, and a source image modified within the previous minute.
// A map pin is returned ONLY while the media itself still passes a fresh health check.
const VENICE_3 = {
  id: "nationcam:venice-marina-3",
  name: "Venice Marina — Gulf sky",
  lat: 29.14244,
  lon: -89.21536,
  image: "https://streamer.nationcam.com/memfs/6d99ba5e-d0a6-4329-8383-858004604263.jpg",
  embed: "https://nationcam.com/embed/louisiana/venice-marina/venice-3",
  source: "https://nationcam.com/locations/louisiana/venice-marina/venice-3",
} as const;

const MAX_IMAGE_AGE_MS = 10 * 60_000;

// CFHT documents the west-facing StarCam at the Maunakea summit and embeds this
// exact YouTube video on its own site. Approximate plot point is the telescope,
// not a claim of sub-meter camera placement.
export async function fetchVerifiedCfhtSkyCameraForViewport(context: LayerQueryContext, signal?: AbortSignal): Promise<TrafficCamera[]> {
  const { north, south, east, west } = context.viewport;
  const lat = 19.82525;
  const lon = -155.46888;
  if (lat < south || lat > north || lon < west || lon > east || typeof window === "undefined") return [];
  try {
    const response = await fetch("/api/verified-sky-live", { signal });
    if (!response.ok) return [];
    const health = await response.json() as { live?: boolean; checkedAt?: number };
    if (!health.live || !health.checkedAt || Math.abs(Date.now() - health.checkedAt) > 2 * 60_000) return [];
    return [{
      id: "cfht:starcam-west",
      providerId: "cfht",
      providerRecordId: "starcam-west",
      name: "Maunakea — CFHT west sky",
      lat, lon,
      roadway: null,
      direction: "West",
      source: "CFHT / Asahi StarCam",
      provider: { provider: "PUBLIC/TRAFFIC", sourceId: "cfht", sourceName: "Canada–France–Hawaii Telescope", official: false, experimental: false, displayLabel: "CFHT StarCam" },
      lastUpdateAt: health.checkedAt,
      imageUrl: null,
      streamUrl: "https://www.youtube.com/embed/Q3UhCgsWDw8?autoplay=1&mute=1",
      thumbnailUrl: null,
      previewUrl: null,
      availability: "available",
      freshness: "fresh",
      sourceUrl: "https://www.cfht.hawaii.edu/en/gallery/starcam.php",
      attribution: "CFHT / Asahi",
    }];
  } catch { return []; }
}

export async function fetchVerifiedSkyCamerasForViewport(context: LayerQueryContext, signal?: AbortSignal): Promise<TrafficCamera[]> {
  const { north, south, east, west } = context.viewport;
  if (VENICE_3.lat < south || VENICE_3.lat > north || VENICE_3.lon < west || VENICE_3.lon > east) return [];
  // The health endpoint is part of the OPS worker, not the native client. It checks
  // the upstream bytes/Last-Modified server-side so a stale "LIVE" badge cannot pass.
  if (typeof window === "undefined") return [];
  try {
    const response = await fetch(`/api/camera-health?url=${encodeURIComponent(VENICE_3.image)}`, { signal });
    if (!response.ok) return [];
    const health = await response.json() as { ok?: boolean; bytes?: number; lastModified?: string | null };
    const modifiedAt = Date.parse(health.lastModified ?? "");
    if (!health.ok || !health.bytes || health.bytes < 10_000 || !Number.isFinite(modifiedAt) || Date.now() - modifiedAt > MAX_IMAGE_AGE_MS || modifiedAt > Date.now() + 60_000) return [];
    return [{
      id: VENICE_3.id,
      providerId: "nationcam",
      providerRecordId: "venice-marina-3",
      name: VENICE_3.name,
      lat: VENICE_3.lat,
      lon: VENICE_3.lon,
      roadway: null,
      direction: "Gulf-facing",
      source: "NationCam",
      provider: { provider: "PUBLIC/TRAFFIC", sourceId: "nationcam", sourceName: "NationCam / Venice Marina", official: false, experimental: false, displayLabel: "NationCam" },
      lastUpdateAt: modifiedAt,
      imageUrl: VENICE_3.image,
      streamUrl: VENICE_3.embed,
      thumbnailUrl: VENICE_3.image,
      previewUrl: VENICE_3.image,
      availability: "available",
      freshness: "fresh",
      sourceUrl: VENICE_3.source,
      attribution: "NationCam / Venice Marina",
    }];
  } catch {
    return [];
  }
}
