export interface StreamSource {
  id: string
  name: string
  publisher_online?: boolean
  readers?: number
  reason?: string
  lastSeen?: string | null
}
export interface StreamHealth {
  hasSourceReports: boolean
  summary: string
  sources: StreamSource[]
  ingest: { srt?: { state?: string }; webrtc?: { state?: string } }
  broadcast: { state?: string; detail?: string }
}
export interface KnownStreamUnit { unit_id: string; operator_name?: string; display_name: string; last_seen?: number | string | null }
export function parseStreamHealth(value: unknown, units: KnownStreamUnit[] = []): StreamHealth {
  const stream = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const reported = Array.isArray(stream.sources) ? stream.sources.filter((source): source is StreamSource => Boolean(source && typeof source === "object" && typeof source.id === "string" && typeof source.name === "string")) : []
  const sources = reported.length ? reported : ["Spencer", "Nick", "Producer PC"].map((name) => {
    const unit = units.find((entry) => `${entry.operator_name ?? ""} ${entry.display_name}`.toLowerCase().includes(name.toLowerCase()) || (name === "Spencer" && /striker/i.test(entry.unit_id)) || (name === "Nick" && /tessa/i.test(entry.unit_id)) || (name === "Producer PC" && /phaenon3|producer/i.test(`${entry.unit_id} ${entry.display_name}`)))
    const observed = unit?.last_seen
    const date = observed ? new Date(typeof observed === "number" && observed < 100_000_000_000 ? observed * 1000 : observed) : null
    return { id: unit?.unit_id ?? name, name, reason: "Unknown - no report", lastSeen: date && Number.isFinite(date.getTime()) ? date.toLocaleString() : null }
  })
  return {
    hasSourceReports: reported.length > 0,
    summary: typeof stream.summary === "string" ? stream.summary : reported.length ? "Source status available" : "No per-source stream report received",
    sources,
    ingest: stream.ingest && typeof stream.ingest === "object" ? stream.ingest as StreamHealth["ingest"] : {},
    broadcast: stream.broadcast && typeof stream.broadcast === "object" ? stream.broadcast as StreamHealth["broadcast"] : {},
  }
}
