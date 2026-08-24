import { useEffect, useMemo, useRef, useState } from "react"
import Hls from "hls.js"
import type { TrafficCamera } from "../../../../src/services/mapLayerModels"

type CameraMediaKind = "hls" | "mjpeg" | "video" | "image" | "unavailable"

function mediaFor(camera: TrafficCamera): { kind: CameraMediaKind; url: string | null } {
  const stream = camera.streamUrl?.trim() || null
  const image = camera.previewUrl?.trim() || camera.imageUrl?.trim() || camera.thumbnailUrl?.trim() || null

  if (stream) {
    if (/\.m3u8(?:$|\?)/i.test(stream)) return { kind: "hls", url: stream }
    if (/mjpeg|mjpg|multipart|axis-cgi\/mjpg/i.test(stream)) return { kind: "mjpeg", url: stream }
    if (/\.(?:mp4|webm|ogg)(?:$|\?)/i.test(stream)) return { kind: "video", url: stream }
  }
  if (image) return { kind: "image", url: image }
  return { kind: "unavailable", url: null }
}

function ageLabel(timestamp: number | null) {
  if (!timestamp) return "Update time not reported"
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return "Updated just now"
  if (minutes < 60) return `Updated ${minutes}m ago`
  return `Updated ${Math.round(minutes / 60)}h ago`
}

export function MapCameraViewer({
  camera,
  onClose,
}: {
  camera: TrafficCamera
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [mediaError, setMediaError] = useState("")
  const [imageTick, setImageTick] = useState(0)
  const media = useMemo(() => mediaFor(camera), [camera])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => {
    setMediaError("")
    if (media.kind !== "hls" || !media.url || !videoRef.current) return

    const video = videoRef.current
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = media.url
      void video.play().catch(() => undefined)
      return () => {
        video.pause()
        video.removeAttribute("src")
        video.load()
      }
    }

    if (!Hls.isSupported()) {
      setMediaError("HLS playback is not supported in this browser.")
      return
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
    })
    hls.loadSource(media.url)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      void video.play().catch(() => undefined)
    })
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) setMediaError("Live stream unavailable.")
    })

    return () => hls.destroy()
  }, [media])

  useEffect(() => {
    if (media.kind !== "image") return
    const timer = window.setInterval(() => setImageTick((tick) => tick + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [media.kind, camera.id])

  const fallbackImage = camera.previewUrl ?? camera.imageUrl ?? camera.thumbnailUrl

  return (
    <aside className="map-camera-viewer" role="dialog" aria-modal="false" aria-label={`${camera.name} camera`}>
      <header className="map-camera-viewer__header">
        <div>
          <p>PUBLIC CAMERA</p>
          <h2>{camera.name}</h2>
        </div>
        <button type="button" className="map-camera-viewer__close" onClick={onClose} aria-label="Close camera viewer">
          ×
        </button>
      </header>

      <div className="map-camera-viewer__media">
        {(media.kind === "hls" || media.kind === "video") && media.url && (
          <video
            ref={videoRef}
            src={media.kind === "video" ? media.url : undefined}
            controls
            autoPlay
            muted
            playsInline
            onError={() => setMediaError("Live stream unavailable.")}
          />
        )}

        {media.kind === "mjpeg" && media.url && (
          <img
            src={media.url}
            alt={`${camera.name} live camera`}
            referrerPolicy="no-referrer"
            onError={() => setMediaError("Live camera image unavailable.")}
          />
        )}

        {media.kind === "image" && media.url && (
          <img
            key={`${camera.id}-${imageTick}`}
            src={media.url}
            alt={`${camera.name} camera`}
            referrerPolicy="no-referrer"
            onError={() => setMediaError("Camera image unavailable.")}
          />
        )}

        {mediaError && fallbackImage && media.kind !== "image" && (
          <img
            src={fallbackImage}
            alt={`${camera.name} fallback snapshot`}
            referrerPolicy="no-referrer"
            onError={() => undefined}
          />
        )}

        {(media.kind === "unavailable" || (mediaError && !fallbackImage)) && (
          <div className="map-camera-viewer__unavailable">
            <strong>CAMERA MEDIA UNAVAILABLE</strong>
            <span>{mediaError || "This provider does not expose embeddable media."}</span>
          </div>
        )}

        <span className={`map-camera-viewer__media-badge ${camera.freshness === "stale" ? "stale" : ""}`}>
          {media.kind === "hls" || media.kind === "video" || media.kind === "mjpeg" ? "LIVE" : "CAMERA"}
        </span>
      </div>

      <div className="map-camera-viewer__meta">
        <div><span>ROAD</span><b>{camera.roadway ?? "Not reported"}</b></div>
        <div><span>VIEW</span><b>{camera.direction ?? "Not reported"}</b></div>
        <div><span>STATUS</span><b>{camera.availability.toUpperCase()}</b></div>
        <div><span>AGE</span><b>{ageLabel(camera.lastUpdateAt)}</b></div>
      </div>

      <footer className="map-camera-viewer__footer">
        <span>{camera.provider.displayLabel} · {camera.attribution}</span>
        {camera.sourceUrl && (
          <a href={camera.sourceUrl} target="_blank" rel="noopener noreferrer">
            PROVIDER
          </a>
        )}
      </footer>
    </aside>
  )
}
