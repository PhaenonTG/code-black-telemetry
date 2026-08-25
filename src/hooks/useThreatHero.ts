import type { NearbyThreat } from "../services/situational";
import type { SpcRiskLevel } from "../services/spcOutlook";

export type ThreatHeroTone = "critical" | "elevated" | "watch" | "calm";

export interface ThreatHero {
  tone: ThreatHeroTone;
  label: string;
  detail: string;
}

const ELEVATED_OUTLOOK = new Set(["ENH", "MDT", "HIGH"]);

// Single highest-priority fact, shared by the Home hero band and the persistent tablet header
// strip so the two surfaces can never disagree about what the biggest current risk is. An actual
// active/nearby polygon always outranks a day-level categorical outlook, which always outranks
// "nothing going on."
export function computeThreatHero(nearestThreat: NearbyThreat | null, day1Outlook: SpcRiskLevel | null): ThreatHero {
  if (nearestThreat) {
    const critical = nearestThreat.alert.severity === "tornado" || nearestThreat.alert.severity === "pds";
    return {
      tone: critical ? "critical" : "elevated",
      label: nearestThreat.alert.title.toUpperCase(),
      detail: nearestThreat.inside ? "AT YOUR LOCATION" : `${Math.round(nearestThreat.distanceMi)} MI ${nearestThreat.bearingCardinal} OF YOU`,
    };
  }
  if (day1Outlook && ELEVATED_OUTLOOK.has(day1Outlook.label)) {
    return { tone: "watch", label: `${day1Outlook.labelLong || day1Outlook.label} TODAY`, detail: "SPC DAY 1 CATEGORICAL OUTLOOK" };
  }
  return { tone: "calm", label: "NO ACTIVE THREATS NEARBY", detail: day1Outlook ? `SPC DAY 1: ${day1Outlook.labelLong || day1Outlook.label}` : "AWAITING OUTLOOK DATA" };
}
