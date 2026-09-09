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

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!cameras.length) return null
  return <section className="camera-wall" aria-label="Pinned camera wall">
    <header><div><span>CAMERA WALL</span><b>{cameras.length} / 9 PINNED</b></div></header>
    <div className="camera-wall__grid">
      {cameras.map((camera) => {
        const url = snapshot(camera)
        return <article key={camera.id} className={failed[camera.id] ? "camera-wall__tile camera-wall__tile--failed" : "camera-wall__tile"}>
          <button className="camera-wall__preview" type="button" onClick={() => onOpen(camera)} aria-label={`Open ${camera.name}`}>
            {url && !failed[camera.id]
              ? <img key={`${camera.id}-${tick}`} src={url} alt="" referrerPolicy="no-referrer" onLoad={() => setFailed((current) => ({ ...current, [camera.id]: false }))} onError={() => setFailed((current) => ({ ...current, [camera.id]: true }))} />
              : <span>MEDIA UNAVAILABLE</span>}
          </button>
          <div><button type="button" onClick={() => onOpen(camera)}><b>{camera.name}</b><small>{camera.roadway ?? camera.provider.displayLabel} · {age(camera.lastUpdateAt)}</small></button><button type="button" onClick={() => onRemove(camera.id)} aria-label={`Unpin ${camera.name}`}>×</button></div>
        </article>
      })}
    </div>
  </section>
}
