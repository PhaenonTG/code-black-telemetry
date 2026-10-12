import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fetchKandriveLiveCameraSource, type TrafficCamera } from "../../../../src/services/mapLayerModels"
import { cameraMedia } from "./cameraMedia"
import { SnapshotFeed } from "./SnapshotFeed"

export function CameraFeed({ camera, snapshot = false }: { camera: TrafficCamera; snapshot?: boolean }) {
  const [signedSource, setSignedSource] = useState<{ cameraId: string; url: string } | null>(null)
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 30_000))
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setTick((value) => value + 1); setAttempt((value) => value + 1) }, [])
  useEffect(() => {
    if (snapshot || camera.providerId !== "kandrive-kdot" || camera.streamUrl) return
    const controller = new AbortController()
    void fetchKandriveLiveCameraSource({ lat: camera.lat, lon: camera.lon, providerRecordId: camera.providerRecordId }, controller.signal).then((url) => { if (url && !controller.signal.aborted) setSignedSource({ cameraId: camera.id, url }) }).catch(() => undefined)
    return () => controller.abort()
  }, [camera.id, camera.providerId, camera.providerRecordId, camera.streamUrl, camera.lat, camera.lon, snapshot, attempt])
  const media = useMemo(() => cameraMedia(signedSource?.cameraId === camera.id ? { ...camera, streamUrl: signedSource.url } : camera, snapshot), [camera, signedSource, snapshot])
  useEffect(() => {
    if (media.kind !== "image") return
    const refresh = () => { if (!document.hidden) setTick((value) => value + 1) }
    const timer = window.setInterval(refresh, 30_000)
    document.addEventListener("visibilitychange", refresh)
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [media.kind])
  return <CameraPlayback key={`${camera.id}-${media.kind}-${media.url}-${media.kind === "image" ? 0 : attempt}`} camera={camera} media={media} tick={tick} retry={retry} />
}

function CameraPlayback({ camera, media, tick, retry }: { camera: TrafficCamera; media: ReturnType<typeof cameraMedia>; tick: number; retry: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const nativeHls = useRef(false)
  const [failure, setFailure] = useState("")
  const [playback, setPlayback] = useState<"connecting" | "playing" | "paused" | "buffering">("connecting")
  const [live, setLive] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const progress = useRef({ at: 0, time: 0 })
  const error = failure
  const fallback = Boolean(error && media.image && media.kind !== "image")
  useEffect(() => {
    const video = videoRef.current
    if (media.kind !== "hls" || !media.url || !video || failure) return
    let disposed = false
    let dispose = () => {}
    // Snapshot desks do not download or initialize the HLS engine.
    void import("hls.js").then(({ default: Hls }) => {
      if (disposed) return
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 20 })
        hls.attachMedia(video); hls.loadSource(media.url!)
        hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(() => undefined) })
        hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => setLive(data.details.live))
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal || [401, 403].includes(data.response?.code ?? 0)) { setFailure("Stream unavailable"); setPlayback("connecting") } })
        dispose = () => { hls.destroy(); video.pause() }
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        nativeHls.current = true
        video.src = media.url!; void video.play().catch(() => undefined)
        dispose = () => { video.pause(); video.removeAttribute("src"); video.load() }
      } else setFailure("Stream not supported")
    }).catch(() => { if (!disposed) setFailure("Playback engine unavailable") })
    return () => { disposed = true; dispose() }
  }, [media.kind, media.url, failure])
  useEffect(() => {
    if (failure || !["hls", "video", "mjpeg"].includes(media.kind) || (media.kind === "mjpeg" && imageLoaded)) return
    progress.current.at = Date.now()
    // A stalled provider must not leave "Connecting" or "Live stream" on screen forever.
    // Paused/background video is intentional; only visible, requested playback is timed out.
    const timer = window.setInterval(() => {
      if (document.hidden || playback === "paused") { progress.current.at = Date.now(); return }
      if (Date.now() - progress.current.at >= 20_000) setFailure("Stream timed out")
    }, 1000)
    return () => window.clearInterval(timer)
  }, [failure, imageLoaded, media.kind, playback])
  useEffect(() => {
    if (!fallback) return
    const timer = window.setTimeout(() => { if (!document.hidden) retry() }, 30_000)
    return () => window.clearTimeout(timer)
  }, [fallback, retry])
  const label = error ? "Unavailable" : media.kind === "video" ? "Video" : playback === "playing" ? live ? "Live stream" : "Video" : media.kind === "mjpeg" && imageLoaded ? "Stream connected" : playback === "paused" ? "Paused" : playback === "buffering" ? "Buffering" : "Connecting"
  return <div className="desk-camera-feed">
    {(media.kind === "hls" || media.kind === "video") && !error && <video ref={videoRef} src={media.kind === "video" ? media.url ?? undefined : undefined} autoPlay muted playsInline controls onDurationChange={(event) => { if (nativeHls.current) setLive(event.currentTarget.duration === Infinity) }} onTimeUpdate={(event) => { const time = event.currentTarget.currentTime; if (time !== progress.current.time) progress.current = { time, at: Date.now() } }} onPlaying={() => setPlayback("playing")} onWaiting={() => setPlayback("buffering")} onPause={() => setPlayback("paused")} onError={() => { setFailure("Stream unavailable"); setPlayback("connecting") }} />}
    {(media.kind === "image" || fallback) && <SnapshotFeed url={fallback ? media.image : media.url} tick={tick} name={camera.name} stale={camera.freshness === "stale"} fallback={fallback} retry={retry} />}
    {media.kind === "mjpeg" && !fallback && <img src={media.url ?? undefined} alt={camera.name} referrerPolicy="no-referrer" onLoad={() => setImageLoaded(true)} onError={() => { setFailure("Image unavailable"); setImageLoaded(false) }} />}
    {(media.kind === "unavailable" || (error && !fallback)) && <div className="desk-camera-feed__empty"><strong>{error || "No embeddable media"}</strong><button onClick={retry}>Retry camera</button></div>}
    {media.kind !== "image" && !fallback && <span className="desk-camera-feed__badge" role="status">{label}{camera.freshness === "stale" ? " · Stale source" : ""}</span>}
  </div>
}
