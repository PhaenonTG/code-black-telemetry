import { stateTone } from "../status/systemStatus";
import type { OpsConnectionState } from "../core/types";

const LABELS: Record<OpsConnectionState, string> = {
  LIVE: "LIVE",
  DEGRADED: "DEGRADED",
  STALE: "STALE",
  OFFLINE: "OFFLINE",
  UNAVAILABLE: "UNAVAILABLE",
  CHECKING: "CHECKING",
  DEVELOPMENT: "DEVELOPMENT",
};

export function OpsStatusPill({ state, label = LABELS[state] }: { state: OpsConnectionState; label?: string }) {
  const tone = state === "DEVELOPMENT" ? "neutral" : stateTone(state);
  return (
    <span className={`ops-pill ops-pill--${tone}`}>
      <i />
      {label}
    </span>
  );
}
