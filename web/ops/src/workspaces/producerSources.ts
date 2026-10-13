export interface ProducerSource {
  id: string
  name: string
  state: string
  publisherOnline: boolean
  readers: number
  reason: string
  bitrateKbps: number | null
  sourceAgeSeconds: number | null
  playerUrl: string | null
}

const PRIVATE_PLAYER_BASE = "https://codeblack-core.tail1d0673.ts.net/mtx"
const PLAYER_PATHS: Record<string, string> = {
  STRIKER: "spencer",
  TESSA: "tessa",
}

export function parseProducerSources(value: unknown): ProducerSource[] {
  if (!value || typeof value !== "object") return []
  const sources = (value as { sources?: unknown }).sources
  if (!Array.isArray(sources)) return []
  return sources.flatMap((entry): ProducerSource[] => {
    if (!entry || typeof entry !== "object") return []
    const row = entry as Record<string, unknown>
    if (typeof row.id !== "string" || typeof row.name !== "string") return []
    const path = PLAYER_PATHS[row.id]
    return [{
      id: row.id,
      name: row.name,
      state: typeof row.state === "string" ? row.state : "UNKNOWN",
      publisherOnline: row.publisher_online === true,
      readers: typeof row.readers === "number" ? row.readers : 0,
      reason: typeof row.reason === "string" ? row.reason : "Source state unavailable",
      bitrateKbps: typeof row.bitrate_kbps === "number" ? row.bitrate_kbps : null,
      sourceAgeSeconds: typeof row.source_age_s === "number" ? row.source_age_s : null,
      playerUrl: path ? `${PRIVATE_PLAYER_BASE}/${path}/` : null,
    }]
  })
}

export function chooseProducerSource(sources: ProducerSource[], preferredId: string): ProducerSource | null {
  return sources.find((source) => source.id === preferredId)
    ?? sources.find((source) => source.publisherOnline)
    ?? sources[0]
    ?? null
}
