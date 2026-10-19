import { statusPresentation } from "../core/statusWords"

export function OpsStatusPill({ state, label }: { state: string; label?: string }) {
  if (state.toUpperCase() === "EMPTY") return <span className="ops-state-count">0</span>
  const presentation = statusPresentation(state)
  const development = state === "DEVELOPMENT"
  // Preserve contextual labels supplied by callers, normalizing legacy state words.
  const text = development ? "DEVELOPMENT" : label && label !== state
    ? label.replace(/\b(LIVE|READY|CURRENT|OPEN|ONLINE|OK|PUBLISHING|STALE|DEGRADED|OFFLINE|ERROR|CLOSED|UNAVAILABLE|CHECKING|STANDBY|PENDING|UNKNOWN)\b/g, word => statusPresentation(word).word)
    : presentation.word
  return <span data-state={state} className={`ops-pill ops-pill--${development ? "neutral" : presentation.tone}`} style={{ color: development ? "var(--cb-gray)" : presentation.color }}><i />{text}</span>
}
