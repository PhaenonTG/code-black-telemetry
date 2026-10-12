import type { TrafficCamera } from "../../../../src/services/mapLayerModels"
export function cameraMedia(camera: TrafficCamera, snapshot = false) {
  const image = camera.previewUrl || camera.imageUrl || camera.thumbnailUrl || null
  const stream = snapshot ? null : camera.streamUrl
  if (stream && (stream.startsWith("/api/ardot-camera-stream") || /\.m3u8(?:$|\?)/i.test(stream))) return { kind: "hls", url: stream, image } as const
  if (stream && /mjpeg|mjpg|multipart|axis-cgi\/mjpg/i.test(stream)) return { kind: "mjpeg", url: stream, image } as const
  if (stream && /\.(mp4|webm|ogg)(?:$|\?)/i.test(stream)) return { kind: "video", url: stream, image } as const
  return { kind: image ? "image" : "unavailable", url: image, image } as const
}
export function snapshotUsesProviderCache(url: string | null): boolean {
  if (!url) return false
  try { return [...new URL(url, "https://ops.local").searchParams.keys()].some((key) => /token|signature|x-amz|policy|key-pair/i.test(key)) } catch { return false }
}
export function refreshedSnapshot(url: string | null, bucket: number): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url, "https://ops.local")
    if (snapshotUsesProviderCache(url)) return url
    parsed.searchParams.set("_cb_frame", String(bucket))
    return /^https?:\/\//i.test(url) ? parsed.href : `${parsed.pathname}${parsed.search}`
  } catch { return url }
}
