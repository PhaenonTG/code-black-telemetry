import { statusPresentation } from "../core/statusWords"
export function StatusBadge({ state }: { state: string }) {
  if (state.toUpperCase() === "EMPTY") return <span className="ops-state-count">0</span>
  const { word, color } = statusPresentation(state)
  const development = state === "DEVELOPMENT"
  return <span data-state={state} className="ops-status-badge" style={{ color, borderColor: color }}><i style={{ background: color }} />{development ? "DEVELOPMENT" : word}</span>
}
