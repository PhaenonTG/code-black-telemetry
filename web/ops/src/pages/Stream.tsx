import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PageHeader } from "../components/PageHeader"
import { useCoreOps } from "../core/useCoreOps"
import { fetchStatusCenter } from "../status/statusCenterClient"

interface StreamSource {
  id: string
  name: string
  publisher_online: boolean
  readers: number
  reason?: string
}

interface StreamHealth {
  summary: string
  sources: StreamSource[]
  ingest: { srt?: { state?: string }; webrtc?: { state?: string } }
  broadcast: { state?: string; detail?: string }
}

const youtubeChannelUrl = "https://www.youtube.com/channel/UCafIaG7PZnEI3b5PsKiblfw/live"
const configuredVideoId = (import.meta.env.VITE_YOUTUBE_LIVE_VIDEO_ID as string | undefined)?.trim() ?? ""
const youtubeVideoId = /^[A-Za-z0-9_-]{11}$/.test(configuredVideoId) ? configuredVideoId : null

function parseStreamHealth(value: unknown): StreamHealth | null {
  if (!value || typeof value !== "object") return null
  const stream = value as Record<string, unknown>
  if (!Array.isArray(stream.sources)) return null
  return {
    summary: typeof stream.summary === "string" ? stream.summary : "Source status available",
    sources: stream.sources.filter((source): source is StreamSource => Boolean(source && typeof source === "object" && typeof source.id === "string" && typeof source.name === "string")),
    ingest: stream.ingest && typeof stream.ingest === "object" ? stream.ingest as StreamHealth["ingest"] : {},
    broadcast: stream.broadcast && typeof stream.broadcast === "object" ? stream.broadcast as StreamHealth["broadcast"] : {},
  }
}

export default function Stream() {
  const { config } = useCoreOps()
  const [health, setHealth] = useState<StreamHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadYoutubePlayer, setLoadYoutubePlayer] = useState(false)
  const refresh = useCallback(async () => {
    try {
      const status = await fetchStatusCenter(config)
      setHealth(parseStreamHealth(status.streaming))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stream telemetry unavailable")
    }
  }, [config])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  return (
    <div className="page page-stream">
      <PageHeader title="PROGRAM STATUS" kicker="FIELD · STREAM INFRASTRUCTURE" description="Watch the Code Black WX YouTube broadcast and review field ingest status. Use Producer for the private PROGRAM monitor and output controls." actions={<Link className="page-action-link" to="/producer">OPEN PRODUCER</Link>} />
      <nav className="section-tabs" aria-label="Chase Operations sections">
        <Link to="/chase">FLEET</Link><span className="active">STREAMS</span>
      </nav>
      <section className="stream-stage">
        <div className="stream-stage__label"><i /> YOUTUBE PROGRAM FEED</div>
        {youtubeVideoId && loadYoutubePlayer ? (
          <iframe
            title="Code Black WX YouTube broadcast"
            src={`https://www.youtube-nocookie.com/embed/${youtubeVideoId}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="stream-stage__standby">
            <strong>{youtubeVideoId ? "CODE BLACK WX ON YOUTUBE" : "YOUTUBE LIVE SETUP IN PROGRESS"}</strong>
            <p>{youtubeVideoId ? "Load the current broadcast here, or open it directly on YouTube." : "The channel is ready to link here once YouTube live access is verified and a broadcast is scheduled."}</p>
            {youtubeVideoId && <button type="button" className="page-action-link" onClick={() => setLoadYoutubePlayer(true)}>Load YouTube player</button>}
            <a className="page-action-link" href={youtubeChannelUrl} target="_blank" rel="noopener noreferrer">Open Code Black WX on YouTube ↗</a>
          </div>
        )}
      </section>
      {youtubeVideoId && loadYoutubePlayer && <a className="page-action-link" href={`https://www.youtube.com/watch?v=${youtubeVideoId}`} target="_blank" rel="noopener noreferrer">Open broadcast on YouTube ↗</a>}
      <section className="stream-health" aria-label="Stream infrastructure status">
        <div className="stream-health__heading"><h2>LIVE SOURCE STATUS</h2><button type="button" onClick={() => { void refresh() }}>REFRESH</button></div>
        <p>{error ?? health?.summary ?? "Checking ingest telemetry…"} · Offline field sources are informational until a broadcast is scheduled.</p>
        <div className="stream-health__grid">
          {health?.sources.map((source) => <article key={source.id} className="stream-health__source">
            <span className={source.publisher_online ? "stream-health__dot stream-health__dot--live" : "stream-health__dot"} />
            <strong>{source.name}</strong>
            <span>{source.publisher_online ? "PUBLISHING" : "OFFLINE"}</span>
            <small>{source.publisher_online ? `${source.readers ?? 0} viewer(s)` : source.reason ?? "No publisher connected"}</small>
          </article>)}
        </div>
        {health && <p>Ingest: SRT {health.ingest.srt?.state ?? "UNKNOWN"} · WebRTC {health.ingest.webrtc?.state ?? "UNKNOWN"} · Facebook availability {health.broadcast.state ?? "UNKNOWN"}</p>}
      </section>
    </div>
  );
}
