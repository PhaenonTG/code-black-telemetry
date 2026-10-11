export type WarningKind = "Tornado Warning" | "Severe Thunderstorm Warning";

export interface PolicyDraft {
  warning: WarningKind;
  candidateAvailable: boolean;
  evidenceScore: number;
  evidenceCutoff: number;
  scanAgeMinutes: number;
  deliveryEnabled: boolean;
}

export type Decision = "NO_CANDIDATE" | "STALE" | "BELOW_CUTOFF" | "SHADOW" | "WOULD_ROUTE";

export interface PolicyResult {
  decision: Decision;
  reason: string;
  fabric: boolean;
  ops: boolean;
  discord: boolean;
  trace: Array<{ step: string; outcome: string }>;
}

// This models the downstream dispatch gates for UI design. It does not run the
// radar algorithm, write Core configuration, or publish a message.
export function simulatePolicy(draft: PolicyDraft): PolicyResult {
  const score = Math.max(0, Math.min(100, Math.round(draft.evidenceScore)));
  const cutoff = Math.max(70, Math.min(100, Math.round(draft.evidenceCutoff)));
  const trace = [
    { step: "Official NWS warning", outcome: `${draft.warning} · independent Discord alert remains unchanged` },
    { step: "Radar acquisition", outcome: "Nearest WSR-88D and newest completed volume (simulated)" },
  ];
  let decision: Decision;
  let reason: string;
  if (!draft.candidateAvailable) {
    decision = "NO_CANDIDATE";
    reason = "No persistent, corroborated radar candidate was supplied.";
  } else if (!Number.isFinite(draft.scanAgeMinutes) || draft.scanAgeMinutes < 0 || draft.scanAgeMinutes > 15) {
    decision = "STALE";
    reason = "Candidate is older than the 15-minute downstream freshness limit.";
  } else if (score < cutoff) {
    decision = "BELOW_CUTOFF";
    reason = `Evidence score ${score} is below the draft cutoff ${cutoff}.`;
  } else if (!draft.deliveryEnabled) {
    decision = "SHADOW";
    reason = "Candidate passes the draft cutoff, but delivery is switched off.";
  } else {
    decision = "WOULD_ROUTE";
    reason = "This draft would route a supplemental, unconfirmed candidate.";
  }
  trace.push({ step: "Evidence policy", outcome: reason });
  const routed = decision === "WOULD_ROUTE";
  trace.push({ step: "Fabric feed", outcome: routed ? "Would append one idempotent alert event" : "No public alert event" });
  trace.push({ step: "Subscribers", outcome: routed ? "OPS map + weather-alerts Discord would receive it" : "No Aegis notification" });
  return { decision, reason, fabric: routed, ops: routed, discord: routed, trace };
}

export const DEFAULT_DRAFT: PolicyDraft = {
  warning: "Tornado Warning",
  candidateAvailable: true,
  evidenceScore: 92,
  evidenceCutoff: 85,
  scanAgeMinutes: 4,
  deliveryEnabled: false,
};
