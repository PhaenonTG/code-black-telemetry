import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { StatusBadge } from "../components/StatusBadge"
import { EmptyState, ErrorState } from "../components/AsyncViewState"
import { formatOpsTimestamp } from "../core/timeFormat"
import { statusWord } from "../core/statusWords"
import { PageHeader } from "../components/PageHeader"
import { useCoreOps } from "../core/useCoreOps"
import { fetchStatusCenter } from "../status/statusCenterClient"

import { parseStreamHealth, type StreamHealth, type KnownStreamUnit } from "../status/streamSources"

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

  return <SourcesContent health={health} error={error} units={state?.fabric?.units?.units ?? []} onRefresh={() => { void refresh() }} />
}

export function SourcesContent({ health, error, units, onRefresh }: { health: StreamHealth | null; error: string | null; units: KnownStreamUnit[]; onRefresh: () => void }) {
  const displayedHealth = health?.hasSourceReports ? health : parseStreamHealth(null, units)

  return (
    <div className="page page-stream">
      <PageHeader routePath="/producer" title="" description="Review field ingest status. Sources is read-only; the private monitor and output controls are in Control." />
      <nav className="section-tabs" aria-label="Producer tabs"><Link to="/producer">Control</Link><Link className="active" aria-current="page" to="/producer/sources">Sources</Link></nav>
      <section className="stream-health" aria-label="Stream infrastructure status">
        <div className="stream-health__heading"><h2>Live Source Status</h2><button type="button" title="Reload source and ingest telemetry" onClick={onRefresh}>Refresh</button></div>
        <p>{error ? "Source telemetry unavailable" : health?.summary ?? "Waiting for ingest telemetry…"} · Offline field sources are informational until a broadcast is scheduled.</p>
        {error && <ErrorState message="Source telemetry could not be refreshed. Last received sources remain below." details={error} onRetry={onRefresh} />}
        {displayedHealth.sources.length === 0 && <EmptyState title="No sources reported" message="Sources appear here when ingest telemetry is available." />}
        <div className="stream-health__grid">
          {displayedHealth.sources.map((source) => <article key={source.id} className="stream-health__source">
            <span className={source.publisher_online ? "stream-health__dot stream-health__dot--live" : "stream-health__dot"} />
            <strong>{source.name}</strong>
            <StatusBadge state={source.publisher_online === undefined ? "Unknown, no report" : source.publisher_online ? "LIVE" : "OFFLINE"} />
            <small>{source.lastSeen ? `Last seen ${formatOpsTimestamp(source.lastSeen)}` : source.publisher_online ? source.readers == null ? `— viewer(s) · ${statusWord("UNAVAILABLE")}` : `${source.readers} viewer(s)` : source.reason === "Unknown - no report" ? "No report yet" : source.reason ?? "No publisher connected"}</small>
          </article>)}
        </div>
        <p>Ingest: SRT {statusWord(health?.ingest.srt?.state)} · WebRTC {statusWord(health?.ingest.webrtc?.state)} · Facebook availability {statusWord(health?.broadcast.state)}</p>
      </section>
      <aside className="stream-monitor-notice"><p>This page does not expose the authenticated PROGRAM feed. Use Control to monitor private video, audio, and Facebook output readiness.</p><Link to="/producer">Open private PROGRAM monitor →</Link></aside>
    </div>
  );
}
