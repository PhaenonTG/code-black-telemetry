import { useEffect, useState } from "react"
import type { TrafficCamera } from "../../../../src/services/mapLayerModels"

function snapshot(camera: TrafficCamera) {
  return camera.previewUrl ?? camera.imageUrl ?? camera.thumbnailUrl ?? null
}

function age(timestamp: number | null) {
  if (!timestamp) return "AGE UNKNOWN"
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  return minutes < 60 ? `${minutes}M OLD` : `${Math.round(minutes / 60)}H OLD`
}

export function CameraWall({ cameras, onOpen, onRemove }: {
  cameras: TrafficCamera[]
  onOpen: (camera: TrafficCamera) => void
  onRemove: (id: string) => void
}) {
  const [tick, setTick] = useState(0)
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [health, setHealth] = useState<Record<string, { fingerprint: string; repeats: number; ok: boolean }>>({})

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const results = await Promise.all(cameras.map(async (camera) => {
        const url = snapshot(camera)
        if (!url) return [camera.id, null] as const
        try { const response = await fetch(`/api/camera-health?url=${encodeURIComponent(url)}`); return [camera.id, response.ok ? await response.json() as { ok: boolean; fingerprint: string } : null] as const } catch { return [camera.id, null] as const }
      }))
      if (cancelled) return
      setHealth((current) => {
        const next = { ...current }
        for (const [id, result] of results) {
          if (!result?.ok) { next[id] = { fingerprint: current[id]?.fingerprint ?? "", repeats: 0, ok: false }; continue }
          const repeats = current[id]?.fingerprint === result.fingerprint ? current[id].repeats + 1 : 0
          next[id] = { fingerprint: result.fingerprint, repeats, ok: true }
        }
        return next
      })
    }
    void check(); const timer = window.setInterval(check, 60_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [cameras])

  if (!cameras.length) return null
  return <section className="camera-wall" aria-label="Pinned camera wall">
    <header><div><span>CAMERA WALL</span><b>{cameras.length} / 9 PINNED</b></div></header>
    <div className="camera-wall__grid">
      {cameras.map((camera) => {
        const url = snapshot(camera)
        return <article key={camera.id} className={`${failed[camera.id] ? "camera-wall__tile camera-wall__tile--failed" : "camera-wall__tile"}${camera.id === cameras[0]?.id && cameras.length > 1 ? " camera-wall__tile--primary" : ""}`}>
          <button className="camera-wall__preview" type="button" onClick={() => onOpen(camera)} aria-label={`Open ${camera.name}`}>
            {url && !failed[camera.id]
              ? <img key={`${camera.id}-${tick}`} src={url} alt="" referrerPolicy="no-referrer" onLoad={() => setFailed((current) => ({ ...current, [camera.id]: false }))} onError={() => setFailed((current) => ({ ...current, [camera.id]: true }))} />
              : <span>MEDIA UNAVAILABLE</span>}
          </button>
          <div><button type="button" onClick={() => onOpen(camera)}><b>{camera.name}</b><small>{health[camera.id]?.repeats >= 3 ? "POSSIBLY FROZEN" : health[camera.id]?.ok === false ? "HEALTH CHECK FAILED" : camera.roadway ?? camera.provider.displayLabel} · {age(camera.lastUpdateAt)}</small></button><button type="button" onClick={() => onRemove(camera.id)} aria-label={`Unpin ${camera.name}`}>×</button></div>
        </article>
      })}
    </div>
  </section>
}
