import type { LayerQueryContext, ObservationProvenance, ViewportLayerResult } from "./mapLayerModels";

export type ChaserNetRole =
  | "applicant"
  | "probationary"
  | "verified-chaser"
  | "verified-spotter"
  | "team-partner"
  | "moderator"
  | "admin";

export type ChaserNetPresenceState = "active-chase" | "observing" | "repositioning" | "stationary" | "off-duty" | "emergency";
export type ChaserNetLocationVisibility = "team-only" | "trusted-network" | "delayed" | "hidden";
export type ChaserNetVerificationLevel = "unverified" | "identity" | "spotter" | "chaser" | "admin";

export interface ChaserNetMember {
  memberId: string;
  displayName: string;
  callsign: string;
  team: string | null;
  role: ChaserNetRole;
  verificationLevel: ChaserNetVerificationLevel;
  status: ChaserNetPresenceState;
  privacy: {
    locationVisibility: ChaserNetLocationVisibility;
    preciseLocationAllowed: boolean;
  };
  lastSeenAt: number | null;
}

export interface ChaserNetMapMember extends ChaserNetMember {
  id: string;
  lat: number;
  lon: number;
  locationUpdatedAt: number;
  stale: boolean;
  provenance: ObservationProvenance;
}

export const CHASER_NET_PROVENANCE: ObservationProvenance = {
  provider: "CHASERNET/HUMAN",
  sourceId: "codeblack-chasernet",
  sourceName: "Code Black Chaser Net",
  official: false,
  experimental: true,
  displayLabel: "Code Black Chaser Net observation - non-official",
};

export function canExposePreciseChaserLocation(member: ChaserNetMember, viewerScope: "team" | "trusted" | "public") {
  if (!member.privacy.preciseLocationAllowed || member.privacy.locationVisibility === "hidden") return false;
  if (member.privacy.locationVisibility === "team-only") return viewerScope === "team";
  if (member.privacy.locationVisibility === "trusted-network") return viewerScope === "team" || viewerScope === "trusted";
  return viewerScope === "team" || viewerScope === "trusted";
}

export async function getChaserNetMembersForViewport(_context: LayerQueryContext): Promise<ViewportLayerResult<ChaserNetMapMember>> {
  return {
    data: [],
    status: "not-configured",
    message: "Code Black Chaser Net backend not configured.",
    simulated: false,
    fetchedAt: Date.now(),
  };
}
