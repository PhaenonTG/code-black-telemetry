import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { PageHeader } from "../components/PageHeader"
import { useCoreOps } from "../core/useCoreOps"
import { fetchStatusCenter } from "../status/statusCenterClient"

import { parseStreamHealth, type StreamHealth } from "../status/streamSources"

// Was a click-to-load Twitch embed (`player.twitch.tv/?channel=codeblackwx`) -- OBS's primary
// stream output moved to Facebook Live only a while back (Twitch removed entirely from the OBS
// config), so "LOAD PROGRAM FEED" loaded a channel nobody streams to anymore. No public Facebook
// Page/video URL is known to this codebase to embed instead (the social-gateway worker only holds
// a private Page ID, not a public share link), so rather than guess one or point at another stale
// destination, this shows an honest "not configured" state until a real embeddable source is
// wired up. See CHANGELOG/memory for the open "embed Facebook Live on the website" and "pull the
// MediaMTX feed directly + composite the overlay in-browser" follow-up ideas.
export default function Stream() {
  const { config, state } = useCoreOps()
  const [health, setHealth] = useState<StreamHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      const status = await fetchStatusCenter(config)
      const parsed = parseStreamHealth(status.streaming)
      setHealth(parsed)
      // A response without per-source status is not "still checking".
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Stream telemetry unavailable")
    }
  }, [config])

  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh() }, 0)
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [refresh])

  const displayedHealth = health?.hasSourceReports ? health : parseStreamHealth(null, state?.fabric.units?.units ?? [])

  return (
    <div className="page page-stream">
      <PageHeader title="PROGRAM STATUS" kicker="FIELD · STREAM INFRASTRUCTURE" description="Review field ingest status here. Use Producer for the authenticated private PROGRAM monitor and output controls." actions={<Link className="page-action-link" to="/producer">OPEN PRODUCER</Link>} />
      <nav className="section-tabs" aria-label="Field operations sections">
        <Link to="/chase" aria-label="Team and devices">TEAM & DEVICES</Link><span className="active" aria-current="page">PROGRAM STATUS</span>
      </nav>
      <section className="stream-stage">
        <div className="stream-stage__label"><i /> PROGRAM FEED · MONITORED IN PRODUCER</div>
        <div className="stream-stage__standby">
          <strong>PRIVATE MONITOR LIVES IN PRODUCER</strong>
          <p>This status page intentionally does not expose the authenticated PROGRAM feed. Open Producer to monitor video, audio, and Facebook output readiness.</p>
          <Link className="page-action-link" to="/producer">Open private PROGRAM monitor →</Link>
        </div>
      </section>
      <section className="stream-health" aria-label="Stream infrastructure status">
        <div className="stream-health__heading"><h2>LIVE SOURCE STATUS</h2><button type="button" onClick={() => { void refresh() }}>REFRESH</button></div>
        <p>{error ?? health?.summary ?? "Checking ingest telemetry…"} · Offline field sources are informational until a broadcast is scheduled.</p>
        <div className="stream-health__grid">
          {displayedHealth.sources.map((source) => <article key={source.id} className="stream-health__source">
            <span className={source.publisher_online ? "stream-health__dot stream-health__dot--live" : "stream-health__dot"} />
            <strong>{source.name}</strong>
            <span>{source.publisher_online === undefined ? "Unknown - no report" : source.publisher_online ? "PUBLISHING" : "OFFLINE"}</span>
            <small>{source.lastSeen ? `Last seen ${source.lastSeen}` : source.publisher_online ? `${source.readers ?? 0} viewer(s)` : source.reason ?? "No publisher connected"}</small>
          </article>)}
        </div>
        {health && <p>Ingest: SRT {health.ingest.srt?.state ?? "UNKNOWN"} · WebRTC {health.ingest.webrtc?.state ?? "UNKNOWN"} · Facebook availability {health.broadcast.state ?? "UNKNOWN"}</p>}
      </section>
    </div>
  );
}
