import { useEffect, useRef, useState, type ReactNode } from "react"
import type Hls from "hls.js"
import { currentAccessToken } from "../core/client"
import { currentMediaTimestamp, isProgramMediaUrl, mediaCompositionMatches, monitorRecoveryDelay } from "./programMonitorPolicy"

export default function ProgramMonitor({ active, canStart, fallback, compositionId, onRunningChange }: { active: boolean; canStart: boolean; fallback: ReactNode; compositionId?: string; onRunningChange?: (running: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const player = useRef<Hls | null>(null)
  const sessionActive = useRef(false)
  const failures = useRef(0)
  const [enabled, setEnabled] = useState(false)
  const [muted, setMuted] = useState(true)
  const [state, setState] = useState("Monitor stopped — snapshot fallback")
  const [playing, setPlaying] = useState(false)
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const displayVideo = active && enabled && retryAt === null
  useEffect(() => {
    if (active) return
    const timer = window.setTimeout(() => { setMuted(true); setPlaying(false); setState("Monitor waiting for current PROGRAM rendering") }, 0)
    return () => window.clearTimeout(timer)
  }, [active])

  useEffect(() => {
    if (!enabled) return
    const hidden = () => { if (document.visibilityState === "hidden") { setEnabled(false); setRetryAt(null); setMuted(true); setPlaying(false); setState("Monitor stopped while this tab was hidden. Restart when ready.") } }
    hidden()
    document.addEventListener("visibilitychange", hidden)
    return () => document.removeEventListener("visibilitychange", hidden)
  }, [enabled])

  useEffect(() => {
    if (!enabled || retryAt === null) return
    const timer = active && canStart && document.visibilityState === "visible" ? window.setTimeout(() => setRetryAt(null), Math.max(0, retryAt - Date.now())) : undefined
    return () => window.clearTimeout(timer)
  }, [active, canStart, enabled, retryAt])

  useEffect(() => {
    if (!displayVideo) return
    let cancelled = false
    let lastManifestAt = Date.now()
    let lastMovementAt = Date.now()
    let lastPosition = 0
    const began = Date.now()
    const media = video.current
    if (!media) return
    sessionActive.current = true
    const stop = (reason: string, recover = false, status = 0) => {
      if (cancelled) return
      cancelled = true; sessionActive.current = false; onRunningChange?.(false)
      const delay = recover ? monitorRecoveryDelay(++failures.current, status) : null
      setState(delay === null ? reason : `${reason} Reconnecting private monitor in ${delay / 1000}s…`); setPlaying(false); setMuted(true)
      if (delay === null) { setEnabled(false); setRetryAt(null) } else setRetryAt(Date.now() + delay)
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
            if (!token) { stop("OPS session unavailable. Sign in before restarting the monitor."); throw new Error("OPS session unavailable") }
            if (cancelled) throw new Error("Monitor stopped")
            xhr.setRequestHeader("Authorization", `Bearer ${token}`)
            xhr.setRequestHeader("Cache-Control", "no-cache")
          },
        })
        player.current = hls
        hls.on(HlsPlayer.Events.LEVEL_LOADED, (_event, data) => {
          const details = data.networkDetails as XMLHttpRequest | null
          const stamp = typeof details?.getResponseHeader === "function" ? currentMediaTimestamp(details.getResponseHeader("X-Producer-Frame-At")) : null
          if (!mediaCompositionMatches(compositionId, details?.getResponseHeader?.("X-Producer-Composition") ?? null)) { stop("PROGRAM composition changed or cannot be verified. Snapshot fallback."); return }
          if (!stamp) { stop("PROGRAM media is stale or cannot be verified. Snapshot fallback.", true); return }
          lastManifestAt = stamp
          if (Date.now() - began > 10000 && !media.paused && media.currentTime > 1) failures.current = 0
        })
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          const code = data.response?.code ?? 0
          if (data.fatal || [401, 403, 404, 409, 429].includes(code)) stop("PROGRAM monitor unavailable. Check source and OPS sign-in; snapshot fallback.", true, code)
        })
        hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => { if (!cancelled) onRunningChange?.(true); void media.play().catch(() => { if (!cancelled) setState("Press the video Play control to start monitoring.") }) })
        hls.attachMedia(media)
        hls.loadSource(new URL("/api/producer/v1/preview/hls/index.m3u8", window.location.origin).href)
        setState("Connecting to authenticated PROGRAM monitor…")
      } catch { stop("PROGRAM monitor could not start. Snapshot fallback.") }
    }
    void boot()
    const watchdog = window.setInterval(() => {
      if (media.currentTime > lastPosition + 0.01) { lastMovementAt = Date.now(); lastPosition = media.currentTime }
      if (Date.now() - lastManifestAt > 7000) stop("PROGRAM media expired. Snapshot fallback.", true)
      else if (!media.paused && Date.now() - lastMovementAt > 5000) stop("PROGRAM playback stalled. Snapshot fallback.", true)
    }, 1000)
    return () => {
      cancelled = true; sessionActive.current = false; onRunningChange?.(false); window.clearInterval(watchdog)
      player.current?.destroy(); player.current = null
      media.pause(); media.removeAttribute("src"); media.load()
    }
  }, [displayVideo, compositionId, onRunningChange])

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
      <button type="button" disabled={!enabled && (!active || !canStart)} onClick={() => { failures.current = 0; setRetryAt(null); setMuted(true); setPlaying(false); setState(enabled ? "Monitor stopped — snapshot fallback" : "Connecting to authenticated PROGRAM monitor…"); setEnabled(!enabled) }}>{enabled ? "Stop monitor" : "Start video monitor"}</button>
      <button type="button" disabled={!displayVideo} onClick={listen}>{muted ? "Listen to PROGRAM" : "Mute PROGRAM"}</button>
      <span role="status" aria-live="polite">{!active ? "Monitor waiting for current PROGRAM rendering" : displayVideo ? `${state}${playing ? muted ? " · MUTED" : " · audio enabled" : ""}` : state}</span>
    </div>
    <p className="workspace-note">Private low-bandwidth PROGRAM monitor, not Facebook playback. Starts muted; enable audio while parked or producing. Older Safari versions without MediaSource support use snapshots.</p>
  </>
}
