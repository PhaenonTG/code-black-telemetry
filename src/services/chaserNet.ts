import type { LayerQueryContext, ObservationProvenance, ViewportLayerResult } from "./mapLayerModels";

export type ChaserNetMembershipState = "applicant" | "probationary" | "active" | "suspended" | "removed";
export type ChaserNetRole = "applicant" | "probationary" | "verified-chaser" | "verified-spotter" | "team-partner" | "moderator" | "admin";
export type ChaserNetTeamRole = "owner" | "team-admin" | "member" | "viewer-partner";
export type ChaserNetPresenceState = "active-chase" | "observing" | "repositioning" | "stationary" | "off-duty" | "emergency";
export type ChaserNetLocationVisibility = "hidden" | "team-only" | "trusted-network" | "delayed";
export type ChaserNetVerificationLevel = "unverified" | "identity" | "spotter" | "chaser" | "admin";
export type ChaserNetPresenceFreshness = "current" | "aging" | "stale" | "offline";
export type ChaserNetGpsQuality = "good" | "degraded" | "stale" | "invalid" | "unknown";
export type ChaserNetConnectionState = "not-configured" | "unauthenticated" | "not-a-member" | "connected" | "degraded";
export type ChaserNetReportVisibility = "team-only" | "trusted-network";
export type ChaserNetReportVerificationState = "unverified" | "corroborated" | "moderator-reviewed" | "retracted" | "disputed";
export type ChaserNetReportConfidence = "low" | "medium" | "high";
export type ChaserNetModerationState = "clear" | "flagged" | "hidden" | "suspended" | "removed";
export type ChaserNetApplicationDecisionStatus = "draft" | "submitted" | "approved" | "rejected" | "withdrawn";
export type ChaserNetAuditAction =
  | "member.approved"
  | "member.role_changed"
  | "member.suspended"
  | "member.reinstated"
  | "application.draft_saved"
  | "application.submitted"
  | "application.reviewed"
  | "team.created"
  | "team.role_changed"
  | "report.created"
  | "report.updated"
  | "report.retracted"
  | "report.moderated"
  | "privacy.changed"
  | "presence.updated";
export type ChaserNetRealtimeEventType =
  | "application.submitted"
  | "application.reviewed"
  | "presence.updated"
  | "presence.offline"
  | "report.created"
  | "report.updated"
  | "report.retracted"
  | "member.updated"
  | "team.updated";
export type ChaserNetReportCategory =
  | "tornado"
  | "funnel-cloud"
  | "wall-cloud"
  | "rotation-suspicious-lowering"
  | "hail"
  | "wind"
  | "wind-damage"
  | "flooding"
  | "flash-flooding"
  | "power-flash"
  | "lightning-damage"
  | "road-blockage"
  | "debris"
  | "visual-confirmation"
  | "other";

export interface ChaserNetAuthenticatedIdentity {
  userId: string;
  provider: string;
  subject: string;
  email?: string;
  displayName?: string;
  authenticatedAt: number;
}

export interface ChaserNetPrivacySettings {
  presenceSharingEnabled: boolean;
  locationVisibility: ChaserNetLocationVisibility;
  preciseLocationAllowed: boolean;
  shareSpeed: boolean;
  shareHeading: boolean;
  delaySeconds: number;
}

export interface ChaserNetMember {
  memberId: string;
  authenticatedUserId: string;
  displayName: string;
  callsign: string;
  teamId: string | null;
  team: string | null;
  membershipState: ChaserNetMembershipState;
  roles: ChaserNetRole[];
  role: ChaserNetRole;
  verificationLevel: ChaserNetVerificationLevel;
  verificationBadges: string[];
  avatarRef: string | null;
  vehicleUnitName: string | null;
  homeRegion: string | null;
  createdAt: number;
  lastActiveAt: number | null;
  status: ChaserNetPresenceState;
  moderationState: ChaserNetModerationState;
  privacy: ChaserNetPrivacySettings;
  publicProfileVisible: boolean;
  trustedProfileVisible: boolean;
}

export interface ChaserNetApplication {
  applicationId: string;
  authenticatedUserId: string;
  publicProfile: {
    displayName: string;
    callsign: string;
    teamAffiliation: string | null;
    chaseWeatherProfileLinks: string[];
  };
  internalReview: {
    legalName: string | null;
    chaseSpotterExperience: string;
    skywarnTraining: string | null;
    spotterNetworkId: string | null;
    references: string[];
    codeOfConductAcceptedAt: number | null;
    reviewerNotes: string[];
  };
  decisionStatus: ChaserNetApplicationDecisionStatus;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  decidedAt: number | null;
  reviewerMemberId: string | null;
}

export interface ChaserNetTeam {
  teamId: string;
  name: string;
  shortName: string;
  logoRef: string | null;
  ownerMemberId: string;
  admins: string[];
  members: Array<{ memberId: string; role: ChaserNetTeamRole; joinedAt: number }>;
  createdAt: number;
  active: boolean;
}

export interface ChaserNetLocation {
  lat: number;
  lon: number;
  horizontalAccuracyM: number | null;
  altitudeM: number | null;
  altitudeAccuracyM: number | null;
  speedMps: number | null;
  speedAccuracyMps: number | null;
  headingDeg: number | null;
  headingAccuracyDeg: number | null;
  provider: string | null;
  quality: ChaserNetGpsQuality;
}

export interface ChaserNetPresence {
  presenceId: string;
  memberId: string;
  teamId: string | null;
  state: ChaserNetPresenceState;
  currentSessionId: string | null;
  timestampUtc: number;
  location: ChaserNetLocation | null;
  source: ObservationProvenance;
}

export interface ChaserNetMapMember extends ChaserNetMember {
  id: string;
  lat: number;
  lon: number;
  locationUpdatedAt: number;
  stale: boolean;
  freshness: ChaserNetPresenceFreshness;
  provenance: ObservationProvenance;
}

export interface ChaserNetReport {
  reportId: string;
  reporterMemberId: string;
  teamId: string | null;
  chaseSessionId: string | null;
  timestampUtc: number;
  lat: number;
  lon: number;
  horizontalAccuracyM: number | null;
  category: ChaserNetReportCategory;
  text: string;
  confidence: ChaserNetReportConfidence;
  verificationState: ChaserNetReportVerificationState;
  visibility: ChaserNetReportVisibility;
  mediaRefs: string[];
  provenance: ObservationProvenance;
  updateState: "active" | "updated" | "retracted";
  moderationState: ChaserNetModerationState;
  createdAt: number;
  updatedAt: number;
  retractedAt: number | null;
}

export interface ChaserNetAuditEvent {
  auditId: string;
  action: ChaserNetAuditAction;
  actorUserId: string;
  actorMemberId: string | null;
  targetType: "application" | "member" | "team" | "report" | "presence" | "privacy";
  targetId: string;
  reason: string;
  timestampUtc: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ChaserNetModerationRecord {
  moderationId: string;
  targetType: "member" | "report";
  targetId: string;
  action: "flag" | "note" | "warning" | "temporary-suspension" | "permanent-removal" | "hide" | "retract";
  reason: string;
  moderatorUserId: string;
  moderatorMemberId: string;
  timestampUtc: number;
  appealStatus: "none" | "open" | "resolved";
}

export interface ChaserNetRealtimeEvent<T = unknown> {
  schemaVersion: 1;
  eventId: string;
  type: ChaserNetRealtimeEventType;
  timestampUtc: number;
  payload: T;
}

export interface ChaserNetHeartbeatPolicy {
  currentMs: number;
  agingMs: number;
  staleMs: number;
}

export interface ChaserNetRateLimitPolicy {
  presenceMinIntervalMs: number;
  reportWindowMs: number;
  reportMaxPerWindow: number;
}

export interface ChaserNetServiceStatus {
  state: ChaserNetConnectionState;
  member: ChaserNetMember | null;
  message: string;
  presenceSharingEnabled: boolean;
}

export interface ChaserNetPresenceInput {
  memberId: string;
  state: ChaserNetPresenceState;
  currentSessionId: string | null;
  timestampUtc: number;
  location: ChaserNetLocation | null;
}

export interface ChaserNetReportInput {
  reporterMemberId: string;
  chaseSessionId: string | null;
  timestampUtc: number;
  lat: number;
  lon: number;
  horizontalAccuracyM: number | null;
  category: ChaserNetReportCategory;
  text: string;
  confidence: ChaserNetReportConfidence;
  visibility: ChaserNetReportVisibility;
}

export interface ChaserNetApplicationInput {
  publicProfile: ChaserNetApplication["publicProfile"];
  internalReview: Omit<ChaserNetApplication["internalReview"], "reviewerNotes">;
}

export interface ChaserNetApplicationReviewInput {
  decisionStatus: Extract<ChaserNetApplicationDecisionStatus, "approved" | "rejected">;
  reviewerNote: string;
  approvedRole?: ChaserNetRole;
  approvedMembershipState?: ChaserNetMembershipState;
  verificationLevel?: ChaserNetVerificationLevel;
}

export interface ChaserNetReadQuery extends LayerQueryContext {
  identity: ChaserNetAuthenticatedIdentity | null;
  since?: number;
}

export interface ChaserNetApiContract {
  realtimeEvents: ChaserNetRealtimeEventType[];
  read: Record<string, { method: "GET"; path: string; viewportAware?: boolean }>;
  write: Record<string, { method: "POST" | "PATCH"; path: string; authenticated: boolean }>;
}

export interface ChaserNetBackendSnapshot {
  schemaVersion: 1;
  members: ChaserNetMember[];
  teams: ChaserNetTeam[];
  applications: ChaserNetApplication[];
  presence: ChaserNetPresence[];
  reports: ChaserNetReport[];
  auditEvents: ChaserNetAuditEvent[];
  capturedAt: number;
}

export interface ChaserNetPersistenceAdapter {
  load(): Promise<ChaserNetBackendSnapshot | null>;
  save(snapshot: ChaserNetBackendSnapshot): Promise<void>;
}

export const CHASER_NET_REPORT_CATEGORIES: ChaserNetReportCategory[] = [
  "tornado",
  "funnel-cloud",
  "wall-cloud",
  "rotation-suspicious-lowering",
  "hail",
  "wind",
  "wind-damage",
  "flooding",
  "flash-flooding",
  "power-flash",
  "lightning-damage",
  "road-blockage",
  "debris",
  "visual-confirmation",
  "other",
];

export const DEFAULT_CHASER_NET_PRIVACY: ChaserNetPrivacySettings = {
  presenceSharingEnabled: false,
  locationVisibility: "hidden",
  preciseLocationAllowed: false,
  shareSpeed: false,
  shareHeading: false,
  delaySeconds: 15 * 60,
};

export const DEFAULT_CHASER_NET_HEARTBEAT_POLICY: ChaserNetHeartbeatPolicy = {
  currentMs: 2 * 60_000,
  agingMs: 6 * 60_000,
  staleMs: 15 * 60_000,
};

export const DEFAULT_CHASER_NET_RATE_LIMIT_POLICY: ChaserNetRateLimitPolicy = {
  presenceMinIntervalMs: 20_000,
  reportWindowMs: 10 * 60_000,
  reportMaxPerWindow: 10,
};

export const CHASER_NET_PROVENANCE: ObservationProvenance = {
  provider: "CHASERNET/HUMAN",
  sourceId: "codeblack-chasernet",
  sourceName: "Code Black Chaser Net",
  official: false,
  experimental: false,
  displayLabel: "Code Black Chaser Net observation - non-official",
};

export const CHASER_NET_API_CONTRACT: ChaserNetApiContract = {
  realtimeEvents: ["application.submitted", "application.reviewed", "presence.updated", "presence.offline", "report.created", "report.updated", "report.retracted", "member.updated", "team.updated"],
  read: {
    me: { method: "GET", path: "/chaser-net/me" },
    members: { method: "GET", path: "/chaser-net/members", viewportAware: true },
    applications: { method: "GET", path: "/chaser-net/applications" },
    presence: { method: "GET", path: "/chaser-net/presence", viewportAware: true },
    reports: { method: "GET", path: "/chaser-net/reports", viewportAware: true },
    teams: { method: "GET", path: "/chaser-net/teams" },
  },
  write: {
    presence: { method: "POST", path: "/chaser-net/presence", authenticated: true },
    applicationDraft: { method: "PATCH", path: "/chaser-net/applications/me", authenticated: true },
    applicationSubmit: { method: "POST", path: "/chaser-net/applications/me/submit", authenticated: true },
    applicationReview: { method: "PATCH", path: "/chaser-net/applications/:id/review", authenticated: true },
    reports: { method: "POST", path: "/chaser-net/reports", authenticated: true },
    updateReport: { method: "PATCH", path: "/chaser-net/reports/:id", authenticated: true },
    retractReport: { method: "POST", path: "/chaser-net/reports/:id/retract", authenticated: true },
    privacy: { method: "PATCH", path: "/chaser-net/me/privacy", authenticated: true },
  },
};

function nowMs() {
  return Date.now();
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${nowMs().toString(36)}`;
}

export function normalizeChaserNetPrivacy(input: Partial<ChaserNetPrivacySettings> = {}): ChaserNetPrivacySettings {
  const visibility: ChaserNetLocationVisibility = ["hidden", "team-only", "trusted-network", "delayed"].includes(String(input.locationVisibility))
    ? input.locationVisibility as ChaserNetLocationVisibility
    : DEFAULT_CHASER_NET_PRIVACY.locationVisibility;
  const delaySeconds = Number.isFinite(input.delaySeconds)
    ? Math.max(60, Math.min(2 * 60 * 60, Math.round(Number(input.delaySeconds))))
    : DEFAULT_CHASER_NET_PRIVACY.delaySeconds;
  const preciseAllowed = Boolean(input.preciseLocationAllowed) && visibility !== "hidden";
  return {
    presenceSharingEnabled: Boolean(input.presenceSharingEnabled),
    locationVisibility: visibility,
    preciseLocationAllowed: preciseAllowed,
    shareSpeed: Boolean(input.shareSpeed) && preciseAllowed,
    shareHeading: Boolean(input.shareHeading) && preciseAllowed,
    delaySeconds,
  };
}

export function chaserNetDisplayVisibility(visibility: ChaserNetLocationVisibility) {
  if (visibility === "hidden") return "Hidden";
  if (visibility === "team-only") return "My Team";
  if (visibility === "trusted-network") return "Trusted Chaser Net";
  return "Delayed";
}

export function isChaserNetWriteRole(role: ChaserNetRole) {
  return role !== "applicant";
}

export function isChaserNetModeratorRole(role: ChaserNetRole) {
  return role === "moderator" || role === "admin";
}

export function memberCanPublish(member: ChaserNetMember) {
  if (member.membershipState === "suspended" || member.membershipState === "removed") return false;
  return member.roles.some(isChaserNetWriteRole);
}

export function memberCanModerate(member: ChaserNetMember) {
  if (member.membershipState !== "active") return false;
  return member.roles.some(isChaserNetModeratorRole);
}

export function validateChaserNetCoordinate(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function validateChaserNetTimestamp(timestampUtc: number, now = nowMs()) {
  if (!Number.isFinite(timestampUtc)) return false;
  return timestampUtc >= now - 7 * 24 * 60 * 60_000 && timestampUtc <= now + 10 * 60_000;
}

export function presenceFreshness(presence: Pick<ChaserNetPresence, "timestampUtc"> | null, policy = DEFAULT_CHASER_NET_HEARTBEAT_POLICY, now = nowMs()): ChaserNetPresenceFreshness {
  if (!presence) return "offline";
  const age = now - presence.timestampUtc;
  if (age <= policy.currentMs) return "current";
  if (age <= policy.agingMs) return "aging";
  if (age <= policy.staleMs) return "stale";
  return "offline";
}

export function canExposePreciseChaserLocation(member: Pick<ChaserNetMember, "privacy">, viewerScope: "team" | "trusted" | "public") {
  if (!member.privacy.preciseLocationAllowed || member.privacy.locationVisibility === "hidden") return false;
  if (member.privacy.locationVisibility === "team-only") return viewerScope === "team";
  if (member.privacy.locationVisibility === "trusted-network") return viewerScope === "team" || viewerScope === "trusted";
  return viewerScope === "team" || viewerScope === "trusted";
}

export function canViewChaserNetLocation(viewer: ChaserNetMember | null, target: ChaserNetMember) {
  if (!target.privacy.presenceSharingEnabled || target.privacy.locationVisibility === "hidden") return false;
  if (!viewer) return false;
  if (viewer.memberId === target.memberId) return true;
  if (target.privacy.locationVisibility === "team-only") return Boolean(viewer.teamId && viewer.teamId === target.teamId);
  if (target.privacy.locationVisibility === "trusted-network" || target.privacy.locationVisibility === "delayed") {
    return viewer.membershipState === "active" || viewer.membershipState === "probationary";
  }
  return false;
}

function applyPresencePrivacy(presence: ChaserNetPresence, target: ChaserNetMember, viewer: ChaserNetMember | null): ChaserNetPresence | null {
  if (!canViewChaserNetLocation(viewer, target)) {
    return target.privacy.presenceSharingEnabled ? { ...presence, location: null } : null;
  }
  if (!presence.location) return presence;
  return {
    ...presence,
    location: {
      ...presence.location,
      speedMps: target.privacy.shareSpeed ? presence.location.speedMps : null,
      speedAccuracyMps: target.privacy.shareSpeed ? presence.location.speedAccuracyMps : null,
      headingDeg: target.privacy.shareHeading ? presence.location.headingDeg : null,
      headingAccuracyDeg: target.privacy.shareHeading ? presence.location.headingAccuracyDeg : null,
    },
  };
}

function pointInLayerViewport(lat: number, lon: number, context: LayerQueryContext) {
  return lat <= context.viewport.north && lat >= context.viewport.south && lon <= context.viewport.east && lon >= context.viewport.west;
}

function assertAuthenticated(identity: ChaserNetAuthenticatedIdentity | null): asserts identity is ChaserNetAuthenticatedIdentity {
  if (!identity) throw new Error("CHASER_NET_AUTH_REQUIRED");
}

function sanitizeReportText(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 800);
}

function sanitizeApplicationNote(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 600);
}

function normalizeApplicationInput(input: ChaserNetApplicationInput): ChaserNetApplicationInput {
  return {
    publicProfile: {
      displayName: input.publicProfile.displayName.trim().slice(0, 80),
      callsign: input.publicProfile.callsign.trim().slice(0, 40),
      teamAffiliation: input.publicProfile.teamAffiliation?.trim().slice(0, 80) || null,
      chaseWeatherProfileLinks: input.publicProfile.chaseWeatherProfileLinks.map((link) => link.trim()).filter(Boolean).slice(0, 8),
    },
    internalReview: {
      legalName: input.internalReview.legalName?.trim().slice(0, 120) || null,
      chaseSpotterExperience: input.internalReview.chaseSpotterExperience.trim().slice(0, 1200),
      skywarnTraining: input.internalReview.skywarnTraining?.trim().slice(0, 400) || null,
      spotterNetworkId: input.internalReview.spotterNetworkId?.trim().slice(0, 80) || null,
      references: input.internalReview.references.map((reference) => reference.trim()).filter(Boolean).slice(0, 8),
      codeOfConductAcceptedAt: Number.isFinite(input.internalReview.codeOfConductAcceptedAt)
        ? input.internalReview.codeOfConductAcceptedAt
        : null,
    },
  };
}

function createAudit(action: ChaserNetAuditAction, identity: ChaserNetAuthenticatedIdentity, targetType: ChaserNetAuditEvent["targetType"], targetId: string, reason: string, actorMemberId: string | null): ChaserNetAuditEvent {
  return { auditId: makeId("audit"), action, actorUserId: identity.userId, actorMemberId, targetType, targetId, reason, timestampUtc: nowMs() };
}

export class InMemoryChaserNetBackend {
  private members = new Map<string, ChaserNetMember>();
  private teams = new Map<string, ChaserNetTeam>();
  private applications = new Map<string, ChaserNetApplication>();
  private presence = new Map<string, ChaserNetPresence>();
  private reports = new Map<string, ChaserNetReport>();
  private auditEvents: ChaserNetAuditEvent[] = [];
  private reportTimestampsByMember = new Map<string, number[]>();
  private lastPresenceAtByMember = new Map<string, number>();
  private readonly heartbeatPolicy: ChaserNetHeartbeatPolicy;
  private readonly rateLimitPolicy: ChaserNetRateLimitPolicy;

  constructor(
    seed?: { members?: ChaserNetMember[]; teams?: ChaserNetTeam[]; applications?: ChaserNetApplication[]; presence?: ChaserNetPresence[]; reports?: ChaserNetReport[]; auditEvents?: ChaserNetAuditEvent[] },
    heartbeatPolicy = DEFAULT_CHASER_NET_HEARTBEAT_POLICY,
    rateLimitPolicy = DEFAULT_CHASER_NET_RATE_LIMIT_POLICY,
  ) {
    this.heartbeatPolicy = heartbeatPolicy;
    this.rateLimitPolicy = rateLimitPolicy;
    seed?.members?.forEach((member) => this.members.set(member.memberId, member));
    seed?.teams?.forEach((team) => this.teams.set(team.teamId, team));
    seed?.applications?.forEach((application) => this.applications.set(application.authenticatedUserId, application));
    seed?.presence?.forEach((presence) => this.presence.set(presence.memberId, presence));
    seed?.reports?.forEach((report) => this.reports.set(report.reportId, report));
    this.auditEvents = seed?.auditEvents ? [...seed.auditEvents] : [];
  }

  getStatus(identity: ChaserNetAuthenticatedIdentity | null): ChaserNetServiceStatus {
    if (!identity) return { state: "unauthenticated", member: null, message: "Sign in to use Code Black Chaser Net.", presenceSharingEnabled: false };
    const member = this.memberForIdentity(identity);
    if (!member) return { state: "not-a-member", member: null, message: "Chaser Net membership is not configured for this account.", presenceSharingEnabled: false };
    return {
      state: member.membershipState === "suspended" || member.membershipState === "removed" ? "degraded" : "connected",
      member,
      message: member.membershipState === "active" ? "Chaser Net ready." : `Membership state: ${member.membershipState}.`,
      presenceSharingEnabled: member.privacy.presenceSharingEnabled,
    };
  }

  memberForIdentity(identity: ChaserNetAuthenticatedIdentity) {
    return [...this.members.values()].find((member) => member.authenticatedUserId === identity.userId) ?? null;
  }

  upsertMember(identity: ChaserNetAuthenticatedIdentity, member: ChaserNetMember) {
    assertAuthenticated(identity);
    const existing = this.memberForIdentity(identity);
    if (existing && existing.memberId !== member.memberId && !memberCanModerate(existing)) throw new Error("CHASER_NET_ROLE_ESCALATION_DENIED");
    const normalized = { ...member, privacy: normalizeChaserNetPrivacy(member.privacy) };
    this.members.set(normalized.memberId, normalized);
    this.auditEvents.push(createAudit("member.approved", identity, "member", normalized.memberId, "member upsert", existing?.memberId ?? normalized.memberId));
    return normalized;
  }

  updatePrivacy(identity: ChaserNetAuthenticatedIdentity | null, privacy: Partial<ChaserNetPrivacySettings>) {
    assertAuthenticated(identity);
    const member = this.memberForIdentity(identity);
    if (!member) throw new Error("CHASER_NET_MEMBER_REQUIRED");
    const updated = { ...member, privacy: normalizeChaserNetPrivacy({ ...member.privacy, ...privacy }) };
    this.members.set(updated.memberId, updated);
    this.auditEvents.push(createAudit("privacy.changed", identity, "privacy", updated.memberId, "privacy settings changed", updated.memberId));
    return updated.privacy;
  }

  getApplicationForIdentity(identity: ChaserNetAuthenticatedIdentity | null) {
    assertAuthenticated(identity);
    return this.applications.get(identity.userId) ?? null;
  }

  saveApplicationDraft(identity: ChaserNetAuthenticatedIdentity | null, input: ChaserNetApplicationInput) {
    assertAuthenticated(identity);
    const normalized = normalizeApplicationInput(input);
    if (!normalized.publicProfile.displayName || !normalized.publicProfile.callsign) throw new Error("CHASER_NET_APPLICATION_PROFILE_REQUIRED");
    const existing = this.applications.get(identity.userId);
    if (existing && existing.decisionStatus !== "draft") throw new Error("CHASER_NET_APPLICATION_LOCKED");
    const timestamp = nowMs();
    const application: ChaserNetApplication = {
      applicationId: existing?.applicationId ?? makeId("application"),
      authenticatedUserId: identity.userId,
      publicProfile: normalized.publicProfile,
      internalReview: {
        ...normalized.internalReview,
        reviewerNotes: existing?.internalReview.reviewerNotes ?? [],
      },
      decisionStatus: "draft",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      submittedAt: null,
      decidedAt: null,
      reviewerMemberId: null,
    };
    this.applications.set(identity.userId, application);
    this.auditEvents.push(createAudit("application.draft_saved", identity, "application", application.applicationId, "application draft saved", null));
    return application;
  }

  submitApplication(identity: ChaserNetAuthenticatedIdentity | null) {
    assertAuthenticated(identity);
    const application = this.applications.get(identity.userId);
    if (!application) throw new Error("CHASER_NET_APPLICATION_REQUIRED");
    if (application.decisionStatus !== "draft") throw new Error("CHASER_NET_APPLICATION_LOCKED");
    if (!application.internalReview.codeOfConductAcceptedAt) throw new Error("CHASER_NET_CODE_OF_CONDUCT_REQUIRED");
    if (application.internalReview.chaseSpotterExperience.length < 10) throw new Error("CHASER_NET_EXPERIENCE_REQUIRED");
    const updated: ChaserNetApplication = { ...application, decisionStatus: "submitted", updatedAt: nowMs(), submittedAt: nowMs() };
    this.applications.set(identity.userId, updated);
    this.auditEvents.push(createAudit("application.submitted", identity, "application", updated.applicationId, "application submitted", null));
    return updated;
  }

  listApplicationsForReview(identity: ChaserNetAuthenticatedIdentity | null) {
    assertAuthenticated(identity);
    const member = this.memberForIdentity(identity);
    if (!member || !memberCanModerate(member)) throw new Error("CHASER_NET_PERMISSION_DENIED");
    return [...this.applications.values()].filter((application) => application.decisionStatus === "submitted");
  }

  reviewApplication(identity: ChaserNetAuthenticatedIdentity | null, applicationId: string, review: ChaserNetApplicationReviewInput) {
    assertAuthenticated(identity);
    const reviewer = this.memberForIdentity(identity);
    if (!reviewer || !memberCanModerate(reviewer)) throw new Error("CHASER_NET_PERMISSION_DENIED");
    const application = [...this.applications.values()].find((item) => item.applicationId === applicationId);
    if (!application) throw new Error("CHASER_NET_APPLICATION_NOT_FOUND");
    if (application.decisionStatus !== "submitted") throw new Error("CHASER_NET_APPLICATION_LOCKED");
    const note = sanitizeApplicationNote(review.reviewerNote);
    if (!note) throw new Error("CHASER_NET_REVIEW_REASON_REQUIRED");
    const decidedAt = nowMs();
    const updated: ChaserNetApplication = {
      ...application,
      decisionStatus: review.decisionStatus,
      updatedAt: decidedAt,
      decidedAt,
      reviewerMemberId: reviewer.memberId,
      internalReview: {
        ...application.internalReview,
        reviewerNotes: [...application.internalReview.reviewerNotes, note].slice(-20),
      },
    };
    this.applications.set(application.authenticatedUserId, updated);
    if (review.decisionStatus === "approved") {
      const role = review.approvedRole ?? "probationary";
      const membershipState = review.approvedMembershipState ?? "probationary";
      const now = nowMs();
      const member: ChaserNetMember = {
        memberId: makeId("member"),
        authenticatedUserId: application.authenticatedUserId,
        displayName: application.publicProfile.displayName,
        callsign: application.publicProfile.callsign,
        teamId: null,
        team: application.publicProfile.teamAffiliation,
        membershipState,
        roles: [role],
        role,
        verificationLevel: review.verificationLevel ?? "identity",
        verificationBadges: [],
        avatarRef: null,
        vehicleUnitName: null,
        homeRegion: null,
        createdAt: now,
        lastActiveAt: null,
        status: "off-duty",
        moderationState: "clear",
        privacy: DEFAULT_CHASER_NET_PRIVACY,
        publicProfileVisible: false,
        trustedProfileVisible: true,
      };
      this.members.set(member.memberId, member);
      this.auditEvents.push(createAudit("member.approved", identity, "member", member.memberId, "application approved", reviewer.memberId));
    }
    this.auditEvents.push(createAudit("application.reviewed", identity, "application", application.applicationId, `application ${review.decisionStatus}`, reviewer.memberId));
    return updated;
  }

  createTeam(identity: ChaserNetAuthenticatedIdentity | null, team: ChaserNetTeam) {
    assertAuthenticated(identity);
    const member = this.memberForIdentity(identity);
    if (!member || !memberCanModerate(member)) throw new Error("CHASER_NET_PERMISSION_DENIED");
    this.teams.set(team.teamId, team);
    this.auditEvents.push(createAudit("team.created", identity, "team", team.teamId, "team created", member.memberId));
    return team;
  }

  submitPresence(identity: ChaserNetAuthenticatedIdentity | null, input: ChaserNetPresenceInput) {
    assertAuthenticated(identity);
    const member = this.memberForIdentity(identity);
    if (!member || member.memberId !== input.memberId) throw new Error("CHASER_NET_MEMBER_REQUIRED");
    if (!memberCanPublish(member)) throw new Error("CHASER_NET_PERMISSION_DENIED");
    if (!validateChaserNetTimestamp(input.timestampUtc)) throw new Error("CHASER_NET_INVALID_TIMESTAMP");
    const lastPresenceAt = this.lastPresenceAtByMember.get(member.memberId) ?? 0;
    if (input.timestampUtc - lastPresenceAt < this.rateLimitPolicy.presenceMinIntervalMs && input.state === member.status) throw new Error("CHASER_NET_PRESENCE_RATE_LIMITED");
    if (input.location && !validateChaserNetCoordinate(input.location.lat, input.location.lon)) throw new Error("CHASER_NET_INVALID_COORDINATE");
    const presence: ChaserNetPresence = {
      presenceId: makeId("presence"),
      memberId: member.memberId,
      teamId: member.teamId,
      state: input.state,
      currentSessionId: input.currentSessionId,
      timestampUtc: input.timestampUtc,
      location: member.privacy.presenceSharingEnabled ? input.location : null,
      source: CHASER_NET_PROVENANCE,
    };
    this.presence.set(member.memberId, presence);
    this.lastPresenceAtByMember.set(member.memberId, input.timestampUtc);
    this.members.set(member.memberId, { ...member, status: input.state, lastActiveAt: input.timestampUtc });
    this.auditEvents.push(createAudit("presence.updated", identity, "presence", member.memberId, "presence updated", member.memberId));
    return presence;
  }

  getPresenceForViewport(query: ChaserNetReadQuery): ViewportLayerResult<ChaserNetMapMember> {
    const viewer = query.identity ? this.memberForIdentity(query.identity) : null;
    const data: ChaserNetMapMember[] = [];
    for (const presence of this.presence.values()) {
      const target = this.members.get(presence.memberId);
      if (!target) continue;
      const visiblePresence = applyPresencePrivacy(presence, target, viewer);
      if (!visiblePresence?.location) continue;
      if (!pointInLayerViewport(visiblePresence.location.lat, visiblePresence.location.lon, query)) continue;
      const freshness = presenceFreshness(visiblePresence, this.heartbeatPolicy);
      if (freshness === "offline") continue;
      data.push({
        ...target,
        id: target.memberId,
        lat: visiblePresence.location.lat,
        lon: visiblePresence.location.lon,
        locationUpdatedAt: visiblePresence.timestampUtc,
        stale: freshness === "aging" || freshness === "stale",
        freshness,
        provenance: CHASER_NET_PROVENANCE,
      });
    }
    return { data, status: data.length ? "ready" : "empty", message: data.length ? "Permitted Chaser Net members loaded." : "No permitted Chaser Net presence in this viewport.", simulated: false, fetchedAt: nowMs() };
  }

  createReport(identity: ChaserNetAuthenticatedIdentity | null, input: ChaserNetReportInput) {
    assertAuthenticated(identity);
    const member = this.memberForIdentity(identity);
    if (!member || member.memberId !== input.reporterMemberId) throw new Error("CHASER_NET_MEMBER_REQUIRED");
    if (!memberCanPublish(member)) throw new Error("CHASER_NET_PERMISSION_DENIED");
    if (!validateChaserNetCoordinate(input.lat, input.lon)) throw new Error("CHASER_NET_INVALID_COORDINATE");
    if (!validateChaserNetTimestamp(input.timestampUtc)) throw new Error("CHASER_NET_INVALID_TIMESTAMP");
    if (!CHASER_NET_REPORT_CATEGORIES.includes(input.category)) throw new Error("CHASER_NET_INVALID_REPORT_CATEGORY");
    const text = sanitizeReportText(input.text);
    if (text.length < 3) throw new Error("CHASER_NET_REPORT_TEXT_REQUIRED");
    const reportTimes = this.reportTimestampsByMember.get(member.memberId)?.filter((time) => input.timestampUtc - time < this.rateLimitPolicy.reportWindowMs) ?? [];
    if (reportTimes.length >= this.rateLimitPolicy.reportMaxPerWindow) throw new Error("CHASER_NET_REPORT_RATE_LIMITED");
    reportTimes.push(input.timestampUtc);
    this.reportTimestampsByMember.set(member.memberId, reportTimes);
    const createdAt = nowMs();
    const report: ChaserNetReport = {
      reportId: makeId("report"),
      reporterMemberId: member.memberId,
      teamId: member.teamId,
      chaseSessionId: input.chaseSessionId,
      timestampUtc: input.timestampUtc,
      lat: input.lat,
      lon: input.lon,
      horizontalAccuracyM: input.horizontalAccuracyM,
      category: input.category,
      text,
      confidence: input.confidence,
      verificationState: "unverified",
      visibility: input.visibility,
      mediaRefs: [],
      provenance: CHASER_NET_PROVENANCE,
      updateState: "active",
      moderationState: "clear",
      createdAt,
      updatedAt: createdAt,
      retractedAt: null,
    };
    this.reports.set(report.reportId, report);
    this.auditEvents.push(createAudit("report.created", identity, "report", report.reportId, "report created", member.memberId));
    return report;
  }

  updateReport(identity: ChaserNetAuthenticatedIdentity | null, reportId: string, patch: Partial<Pick<ChaserNetReport, "text" | "confidence" | "verificationState" | "moderationState">>) {
    assertAuthenticated(identity);
    const member = this.memberForIdentity(identity);
    const report = this.reports.get(reportId);
    if (!member || !report) throw new Error("CHASER_NET_REPORT_NOT_FOUND");
    const ownsReport = report.reporterMemberId === member.memberId;
    if (!ownsReport && !memberCanModerate(member)) throw new Error("CHASER_NET_PERMISSION_DENIED");
    if (patch.verificationState && !memberCanModerate(member)) throw new Error("CHASER_NET_PERMISSION_DENIED");
    const updated: ChaserNetReport = {
      ...report,
      text: patch.text != null ? sanitizeReportText(patch.text) : report.text,
      confidence: patch.confidence ?? report.confidence,
      verificationState: patch.verificationState ?? report.verificationState,
      moderationState: patch.moderationState ?? report.moderationState,
      updateState: report.updateState === "retracted" ? "retracted" : "updated",
      updatedAt: nowMs(),
    };
    this.reports.set(reportId, updated);
    this.auditEvents.push(createAudit(patch.moderationState ? "report.moderated" : "report.updated", identity, "report", reportId, "report updated", member.memberId));
    return updated;
  }

  retractReport(identity: ChaserNetAuthenticatedIdentity | null, reportId: string) {
    assertAuthenticated(identity);
    const member = this.memberForIdentity(identity);
    const report = this.reports.get(reportId);
    if (!member || !report) throw new Error("CHASER_NET_REPORT_NOT_FOUND");
    if (report.reporterMemberId !== member.memberId && !memberCanModerate(member)) throw new Error("CHASER_NET_PERMISSION_DENIED");
    const updated: ChaserNetReport = { ...report, verificationState: "retracted", updateState: "retracted", updatedAt: nowMs(), retractedAt: nowMs() };
    this.reports.set(reportId, updated);
    this.auditEvents.push(createAudit("report.retracted", identity, "report", reportId, "report retracted", member.memberId));
    return updated;
  }

  getReportsForViewport(query: ChaserNetReadQuery): ViewportLayerResult<ChaserNetReport> {
    const viewer = query.identity ? this.memberForIdentity(query.identity) : null;
    const data = [...this.reports.values()].filter((report) => {
      if (report.updateState === "retracted" || report.moderationState === "hidden" || report.moderationState === "removed") return false;
      if (!pointInLayerViewport(report.lat, report.lon, query)) return false;
      if (query.since && report.updatedAt < query.since) return false;
      if (report.visibility === "team-only") return Boolean(viewer?.teamId && viewer.teamId === report.teamId);
      return Boolean(viewer && (viewer.membershipState === "active" || viewer.membershipState === "probationary"));
    });
    return { data, status: data.length ? "ready" : "empty", message: data.length ? "Permitted Chaser Net reports loaded." : "No permitted Chaser Net reports in this viewport.", simulated: false, fetchedAt: nowMs() };
  }

  getAuditEvents() {
    return [...this.auditEvents];
  }

  getTeams(identity: ChaserNetAuthenticatedIdentity | null) {
    assertAuthenticated(identity);
    const member = this.memberForIdentity(identity);
    if (!member) return [];
    return [...this.teams.values()].filter((team) => team.members.some((entry) => entry.memberId === member.memberId) || memberCanModerate(member));
  }

  toSnapshot(): ChaserNetBackendSnapshot {
    return {
      schemaVersion: 1,
      members: [...this.members.values()],
      teams: [...this.teams.values()],
      applications: [...this.applications.values()],
      presence: [...this.presence.values()],
      reports: [...this.reports.values()],
      auditEvents: [...this.auditEvents],
      capturedAt: nowMs(),
    };
  }
}

export function createChaserNetBackendFromSnapshot(snapshot: ChaserNetBackendSnapshot | null) {
  if (!snapshot) return new InMemoryChaserNetBackend();
  if (snapshot.schemaVersion !== 1) throw new Error("CHASER_NET_SNAPSHOT_VERSION_UNSUPPORTED");
  return new InMemoryChaserNetBackend({
    members: snapshot.members,
    teams: snapshot.teams,
    applications: snapshot.applications,
    presence: snapshot.presence,
    reports: snapshot.reports,
    auditEvents: snapshot.auditEvents,
  });
}

export async function persistChaserNetBackend(backend: InMemoryChaserNetBackend, adapter: ChaserNetPersistenceAdapter) {
  await adapter.save(backend.toSnapshot());
}

export async function loadChaserNetBackend(adapter: ChaserNetPersistenceAdapter) {
  return createChaserNetBackendFromSnapshot(await adapter.load());
}

const unconfiguredStatus: ChaserNetServiceStatus = {
  state: "not-configured",
  member: null,
  message: "Code Black Chaser Net backend is not configured yet.",
  presenceSharingEnabled: false,
};

export function getChaserNetServiceStatus(): ChaserNetServiceStatus {
  return unconfiguredStatus;
}

export async function getChaserNetMembersForViewport(_context: LayerQueryContext): Promise<ViewportLayerResult<ChaserNetMapMember>> {
  return { data: [], status: "not-configured", message: "Code Black Chaser Net backend not configured.", simulated: false, fetchedAt: nowMs() };
}

export async function getChaserNetReportsForViewport(_context: LayerQueryContext): Promise<ViewportLayerResult<ChaserNetReport>> {
  return { data: [], status: "not-configured", message: "Code Black Chaser Net report backend not configured.", simulated: false, fetchedAt: nowMs() };
}
