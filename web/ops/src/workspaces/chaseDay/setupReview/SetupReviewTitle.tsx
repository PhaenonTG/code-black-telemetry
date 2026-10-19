import type { ReactNode } from "react"
import { OpsStatusPill } from "../../../components/OpsStatusPill"
import { formatOpsTimestamp } from "../../../core/timeFormat"

export function SetupReviewTime({ value }: { value?: string | number | null }) {
  if (value === undefined || value === null || !Number.isFinite(new Date(value).getTime())) return <>—</>
  const utc = new Date(value).toISOString()
  return <time dateTime={utc} title={utc}>{formatOpsTimestamp(value)}</time>
}

/** One title-row position for source state and the existing read-only refresh action. */
export function SetupReviewTitle({ title, description, state, checkedAt, busy, refresh, reloads, children }: {
  title: string; description: string; state: string; checkedAt?: string; busy?: boolean;
  refresh: () => void; reloads: string; children?: ReactNode
}) {
  const valid = checkedAt && Number.isFinite(Date.parse(checkedAt)) ? checkedAt : undefined
  return <header className="analysis-tab-title">
    <div><h2>{title}</h2><p>{description}</p>{children}</div>
    <div className="analysis-tab-actions"><OpsStatusPill state={state} />
      {busy && state !== "Waiting" && <span className="analysis-waiting" role="status" aria-label="Waiting for refresh">●</span>}
      {valid && <time dateTime={valid} title={new Date(valid).toISOString()}>checked {formatOpsTimestamp(valid)}</time>}
      <button type="button" title={`Refresh ${reloads}`} onClick={refresh} disabled={busy}>Refresh</button>
    </div>
  </header>
}
