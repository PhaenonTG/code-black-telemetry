import { useEffect, useRef, useState, type ReactNode } from "react"
import type Hls from "hls.js"
import { currentAccessToken } from "../core/client"
import { currentMediaTimestamp, isProgramMediaUrl, mediaCompositionMatches } from "./programMonitorPolicy"

export default function ProgramMonitor({ active, canStart, fallback, compositionId }: { active: boolean; canStart: boolean; fallback: ReactNode; compositionId?: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const player = useRef<Hls | null>(null)
  const sessionActive = useRef(false)
  const [enabled, setEnabled] = useState(false)
  const [muted, setMuted] = useState(true)
  const [state, setState] = useState("Monitor stopped — snapshot fallback")
  const [playing, setPlaying] = useState(false)
  const displayVideo = active && enabled
  useEffect(() => {
    if (active) return
    const timer = window.setTimeout(() => { setEnabled(false); setMuted(true); setPlaying(false); setState("Monitor waiting for current PROGRAM rendering") }, 0)
    return () => window.clearTimeout(timer)
  }, [active])

  useEffect(() => {
    if (!displayVideo) return
    let cancelled = false
    let lastManifestAt = Date.now()
    let lastMovementAt = Date.now()
    let lastPosition = 0
    const media = video.current
    if (!media) return
    sessionActive.current = true
    const stop = (reason: string) => {
      if (cancelled) return
      cancelled = true; sessionActive.current = false
      setState(reason); setPlaying(false); setEnabled(false)
      media.pause(); player.current?.destroy(); player.current = null
    }
    const boot = async () => {
      try {
        const { default: HlsPlayer } = await import("hls.js")
        if (cancelled) return
        if (!HlsPlayer.isSupported()) { stop("This browser cannot play the authenticated monitor. Snapshot fallback remains available."); return }
        const hls = new HlsPlayer({
          lowLatencyMode: false, preferManagedMediaSource: true,
          liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 4,
          maxBufferLength: 6, maxMaxBufferLength: 8, backBufferLength: 0,
          manifestLoadingTimeOut: 5000, levelLoadingTimeOut: 5000, fragLoadingTimeOut: 5000,
          xhrSetup: async (xhr, url) => {
            if (!isProgramMediaUrl(url, window.location.origin)) throw new Error("Untrusted monitor URL")
            const token = await currentAccessToken()
            if (!token || cancelled) throw new Error("OPS session unavailable")
            xhr.setRequestHeader("Authorization", `Bearer ${token}`)
            xhr.setRequestHeader("Cache-Control", "no-cache")
          },
        })
        player.current = hls
        hls.on(HlsPlayer.Events.LEVEL_LOADED, (_event, data) => {
          const details = data.networkDetails as XMLHttpRequest | null
          const stamp = typeof details?.getResponseHeader === "function" ? currentMediaTimestamp(details.getResponseHeader("X-Producer-Frame-At")) : null
          if (!mediaCompositionMatches(compositionId, details?.getResponseHeader?.("X-Producer-Composition") ?? null)) { stop("PROGRAM composition changed or cannot be verified. Snapshot fallback."); return }
          if (!stamp) { stop("PROGRAM media is stale or cannot be verified. Snapshot fallback."); return }
          lastManifestAt = stamp
        })
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (data.fatal || data.response?.code === 401 || data.response?.code === 403 || data.response?.code === 404) stop("PROGRAM monitor unavailable. Check source and OPS sign-in; snapshot fallback.")
        })
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => { void media.play().catch(() => { if (!cancelled) setState("Press the video Play control to start monitoring.") }) })
        hls.attachMedia(media)
        hls.loadSource(new URL("/api/producer/v1/preview/hls/index.m3u8", window.location.origin).href)
        setState("Connecting to authenticated PROGRAM monitor…")
      } catch { stop("PROGRAM monitor could not start. Snapshot fallback.") }
    }
    void boot()
    const watchdog = window.setInterval(() => {
      if (media.currentTime > lastPosition + 0.01) { lastMovementAt = Date.now(); lastPosition = media.currentTime }
      if (Date.now() - lastManifestAt > 7000) stop("PROGRAM media expired. Snapshot fallback.")
      else if (!media.paused && Date.now() - lastMovementAt > 5000) stop("PROGRAM playback stalled. Snapshot fallback.")
    }, 1000)
    const visibility = () => { if (document.visibilityState === "hidden") stop("Monitor stopped while this tab was hidden. Restart when ready.") }
    document.addEventListener("visibilitychange", visibility)
    return () => {
      cancelled = true; sessionActive.current = false; window.clearInterval(watchdog); document.removeEventListener("visibilitychange", visibility)
      player.current?.destroy(); player.current = null
      media.pause(); media.removeAttribute("src"); media.load()
    }
  }, [displayVideo, compositionId])

  const listen = () => {
    const media = video.current
    if (!media) return
    const next = !media.muted
    media.muted = next; setMuted(next)
    void media.play().catch(() => { media.muted = true; setMuted(true); setState("Audio playback was blocked. Use the video Play/audio controls.") })
  }
  return <>
    <div className="producer-stage__viewport">
      {displayVideo ? <video ref={video} controls playsInline disableRemotePlayback muted={muted} aria-label="Authenticated PROGRAM video and audio monitor"
        onPlaying={() => { if (sessionActive.current) { setPlaying(true); setState("PROGRAM monitor playing") } }}
        onWaiting={() => { if (sessionActive.current) { setPlaying(false); setState("PROGRAM monitor buffering…") } }}
        onPause={() => { if (sessionActive.current) { setPlaying(false); setState("PROGRAM monitor paused") } }}
        onVolumeChange={() => { if (video.current) setMuted(video.current.muted) }}
        onPlay={() => { const target = player.current?.liveSyncPosition; if (typeof target === "number" && video.current && Math.abs(video.current.currentTime - target) > 4) video.current.currentTime = target }} /> : fallback}
    </div>
    <div className="producer-monitor-controls">
      <button type="button" disabled={!active || (!displayVideo && !canStart)} onClick={() => { setMuted(true); setPlaying(false); setState(displayVideo ? "Monitor stopped — snapshot fallback" : "Connecting to authenticated PROGRAM monitor…"); setEnabled(!displayVideo) }}>{displayVideo ? "Stop monitor" : "Start video monitor"}</button>
      <button type="button" disabled={!displayVideo} onClick={listen}>{muted ? "Listen to PROGRAM" : "Mute PROGRAM"}</button>
      <span role="status" aria-live="polite">{!active ? "Monitor waiting for current PROGRAM rendering" : displayVideo ? `${state}${playing ? muted ? " · MUTED" : " · audio enabled" : ""}` : state}</span>
    </div>
    <p className="workspace-note">Private low-bandwidth PROGRAM monitor, not Facebook playback. Starts muted; enable audio while parked or producing. Older Safari versions without MediaSource support use snapshots.</p>
  </>
}
