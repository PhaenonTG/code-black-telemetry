// Shared spelling and color for system status and forecast content.
export const STATUS_WORDS = {
  Live: { kind: "status", color: "var(--cb-green)", tone: "ok" },
  Stale: { kind: "status", color: "var(--cb-amber)", tone: "warn" },
  Offline: { kind: "status", color: "var(--cb-red)", tone: "bad" },
  Unavailable: { kind: "status", color: "var(--cb-gray)", tone: "neutral" },
  Waiting: { kind: "status", color: "var(--cb-amber)", tone: "warn" },
  Available: { kind: "forecast", color: "var(--cb-green)", tone: "ok" },
  Expired: { kind: "forecast", color: "var(--cb-amber)", tone: "warn" },
  "No area": { kind: "forecast", color: "var(--cb-gray)", tone: "neutral" },
  Withheld: { kind: "forecast", color: "var(--cb-amber)", tone: "warn" },
  "No coverage": { kind: "forecast", color: "var(--cb-gray)", tone: "neutral" },
} as const
export type StatusWord = keyof typeof STATUS_WORDS
const ALIASES: Record<string, StatusWord> = {
  CONNECTED: "Live", AGING: "Stale", DISABLED: "Unavailable", NO_DATA: "Unavailable", OUTSIDE_COVERAGE: "Unavailable", "NOT CONFIGURED": "Unavailable",
  LIVE: "Live", READY: "Live", CURRENT: "Live", OPEN: "Live", ONLINE: "Live", OK: "Live", PUBLISHING: "Live", HEALTHY: "Live",
  STALE: "Stale", DEGRADED: "Stale", DELAYED: "Stale", PARTIAL: "Stale",
  OFFLINE: "Offline", ERROR: "Offline", CLOSED: "Offline", FAILED: "Offline",
  UNAVAILABLE: "Unavailable", NOT_CONFIGURED: "Unavailable", "NO DATA": "Unavailable", UNVERIFIED: "Unavailable",
  CHECKING: "Waiting", STANDBY: "Waiting", PENDING: "Waiting", LOADING: "Waiting", WAITING: "Waiting", CONNECTING: "Waiting", UNKNOWN: "Waiting", "UNKNOWN, NO REPORT": "Waiting", "UNKNOWN - NO REPORT": "Waiting",
}
export function statusWord(value: string | null | undefined): StatusWord {
  const canonical = Object.keys(STATUS_WORDS).find(word => word.toUpperCase() === value?.toUpperCase())
  if (canonical) return canonical as StatusWord
  return ALIASES[(value ?? "").toUpperCase()] ?? "Unavailable"
}
export function statusPresentation(value: string | null | undefined) {
  const word = statusWord(value)
  return { word, ...STATUS_WORDS[word] }
}
