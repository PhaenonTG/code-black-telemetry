import { stateTone, type OperationalState } from "../status/systemStatus"

const TONE_COLOR: Record<string, string> = {
  ok: "var(--cb-green)",
  warn: "var(--cb-amber)",
  bad: "var(--cb-red)",
  neutral: "var(--cb-gray)",
}

export function StatusBadge({ state }: { state: OperationalState }) {
  const tone = stateTone(state)
  return (
    <span className="ops-status-badge" style={{ color: TONE_COLOR[tone], borderColor: TONE_COLOR[tone] }}>
      <i style={{ background: TONE_COLOR[tone] }} />
      {state.replace(/_/g, " ")}
    </span>
  )
}
