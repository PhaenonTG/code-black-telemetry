import type { ReactNode } from "react"
import "./AsyncViewState.css"

export type AsyncViewStateKind = "loading" | "stale" | "error" | "empty"

export interface AsyncViewStateProps {
  /** Which presentation to render. The caller owns the data lifecycle; this view never fetches. */
  state: AsyncViewStateKind
  title?: string
  message?: ReactNode
  /**
   * Time of the last successful data the caller actually holds. Rendered only when provided and
   * valid -- this component never invents or estimates a last-success time.
   */
  lastUpdated?: Date | null
  /** Optional caller-supplied hint, e.g. "Cold model data can take up to 90s." Display only. */
  timeoutHint?: string
  /** Optional retry action wired to the caller's existing refresh function. */
  onRetry?: () => void
  retryLabel?: string
  retryDisabled?: boolean
  /** Compact inline banner instead of the default panel. */
  compact?: boolean
  className?: string
  children?: ReactNode
}

const DEFAULT_TITLES: Record<AsyncViewStateKind, string> = {
  loading: "Loading",
  stale: "Showing last received data",
  error: "Unavailable",
  empty: "Nothing to show",
}

const STATE_LABELS: Record<AsyncViewStateKind, string> = {
  loading: "LOADING",
  stale: "STALE",
  error: "ERROR",
  empty: "EMPTY",
}

function validLastUpdated(value: Date | null | undefined): Date | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null
}

function formatLastUpdated(value: Date): string {
  return value.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export function AsyncViewState({
  state, title, message, lastUpdated, timeoutHint, onRetry, retryLabel = "Retry", retryDisabled, compact, className, children,
}: AsyncViewStateProps) {
  const updated = validLastUpdated(lastUpdated)
  // Errors interrupt; loading/stale/empty are polite status updates.
  const role = state === "error" ? "alert" : "status"
  const classes = ["async-view-state", `async-view-state--${state}`, compact ? "async-view-state--compact" : "", className ?? ""].filter(Boolean).join(" ")
  return (
    <div className={classes} role={role} aria-live={state === "error" ? "assertive" : "polite"} data-state={state}>
      <div className="async-view-state__head">
        <span className="async-view-state__badge">{state === "loading" && <i className="async-view-state__spinner" aria-hidden="true" />}{STATE_LABELS[state]}</span>
        <strong className="async-view-state__title">{title ?? DEFAULT_TITLES[state]}</strong>
      </div>
      {message && <p className="async-view-state__message">{message}</p>}
      {updated && <p className="async-view-state__meta">Last updated <time dateTime={updated.toISOString()}>{formatLastUpdated(updated)}</time></p>}
      {timeoutHint && <p className="async-view-state__meta">{timeoutHint}</p>}
      {children}
      {onRetry && <button type="button" className="async-view-state__retry" onClick={onRetry} disabled={retryDisabled}>{retryLabel}</button>}
    </div>
  )
}

export default AsyncViewState
