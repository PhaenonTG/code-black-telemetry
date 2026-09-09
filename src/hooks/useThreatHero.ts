import type { NearbyThreat } from "../services/situational";
import type { SpcRiskLevel } from "../services/spcOutlook";
import { cardinalFromDeg } from "../services/telemetry/quality";

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

const KNOTS_TO_MPH = 1.15078;
// How far off-axis storm motion can point from "straight at the chaser" and still count as
// closing. Real storms wander within a general motion vector -- treating only a razor-exact
// heading as "closing" would flicker between closing/not-closing on ordinary motion noise.
const CLOSING_ANGLE_TOLERANCE_DEG = 45;

export interface StormClosingInfo {
  headingCardinal: string;
  speedMph: number;
  closing: boolean;
  etaMinutes: number | null;
}

// Deliberately separate from computeThreatHero (which TopBar also renders, at a width with no
// room for a third line) -- this is Home-only, chase-focused detail: is the storm actually
// headed toward the chaser's current position, and if so, roughly how long do they have. Never
// shown for a day-level outlook or a threat the chaser is already inside (closing math is
// meaningless once you're already in the polygon -- shelter guidance matters more there than an
// ETA). Storm motion is the single vector the chaser is tracking/chasing (manual entry or radar
// estimate, see services/radar.ts) rather than a per-alert-polygon motion NWS doesn't provide.
export function computeStormClosingInfo(nearestThreat: NearbyThreat | null, motion: { directionDegrees: number; speedKnots: number } | null): StormClosingInfo | null {
  if (!nearestThreat || nearestThreat.inside || !motion || motion.speedKnots <= 0) return null;
  const speedMph = motion.speedKnots * KNOTS_TO_MPH;
  const bearingFromStormToChaser = (nearestThreat.bearingDeg + 180) % 360;
  const rawDiff = Math.abs(motion.directionDegrees - bearingFromStormToChaser) % 360;
  const angularDiff = Math.min(rawDiff, 360 - rawDiff);
  const closing = angularDiff <= CLOSING_ANGLE_TOLERANCE_DEG;
  const etaMinutes = closing ? Math.round((nearestThreat.distanceMi / speedMph) * 60) : null;
  return { headingCardinal: cardinalFromDeg(motion.directionDegrees), speedMph, closing, etaMinutes };
}
