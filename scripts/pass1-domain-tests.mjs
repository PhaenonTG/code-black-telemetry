import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importTs(path) {
  const source = await readFile(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  }).outputText;
  const encoded = Buffer.from(output, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const clock = await importTs("src/services/clock.ts");
const viewport = await importTs("src/map/viewport.ts");
const chaserNet = await importTs("src/services/chaserNet.ts");
const layerManager = await importTs("src/services/mapLayerManager.ts");
const egress = await importTs("src/services/egress.ts");
const locationObservation = await importTs("src/services/locationObservation.ts");

const januaryCentral = clock.formatOpsClock(new Date("2026-01-15T18:15:00Z"), "central");
const julyCentral = clock.formatOpsClock(new Date("2026-07-15T18:15:00Z"), "central");
const zulu = clock.formatOpsClock(new Date("2026-07-15T18:15:00Z"), "zulu");
assert.equal(januaryCentral.zone, "CST");
assert.equal(julyCentral.zone, "CDT");
assert.equal(zulu.zone, "UTC");

const testViewport = { north: 37, south: 36, east: -93, west: -95, zoom: 4 };
const points = [
  { id: "a", lat: 36.2, lon: -94.1 },
  { id: "b", lat: 36.3, lon: -94.2 },
  { id: "c", lat: 40, lon: -90 },
];
assert.equal(viewport.filterViewportPoints(points, testViewport, 0).length, 2);
assert.equal(viewport.zoomDetailLevel(10), "close");
assert.equal(viewport.zoomDetailLevel(7), "medium");
assert.equal(viewport.zoomDetailLevel(3), "far");
assert.ok(viewport.clusterViewportPoints(points.slice(0, 2), testViewport).some((item) => "count" in item && item.count === 2));

const now = Date.parse("2026-08-18T12:00:00Z");
const member = {
  privacy: { preciseLocationAllowed: true, locationVisibility: "team-only" },
};
assert.equal(chaserNet.canExposePreciseChaserLocation(member, "team"), true);
assert.equal(chaserNet.canExposePreciseChaserLocation(member, "trusted"), false);
assert.equal(chaserNet.canExposePreciseChaserLocation({ privacy: { preciseLocationAllowed: false, locationVisibility: "trusted-network" } }, "trusted"), false);
assert.equal(chaserNet.normalizeChaserNetPrivacy({ locationVisibility: "hidden", preciseLocationAllowed: true }).preciseLocationAllowed, false);
assert.equal(chaserNet.presenceFreshness({ timestampUtc: now - 20_000 }, chaserNet.DEFAULT_CHASER_NET_HEARTBEAT_POLICY, now), "current");
assert.equal(chaserNet.presenceFreshness({ timestampUtc: now - 10 * 60_000 }, chaserNet.DEFAULT_CHASER_NET_HEARTBEAT_POLICY, now), "stale");
assert.equal(chaserNet.validateChaserNetCoordinate(36, -94), true);
assert.equal(chaserNet.validateChaserNetCoordinate(136, -94), false);

const identityA = { userId: "user-a", provider: "test", subject: "a", authenticatedAt: now };
const identityB = { userId: "user-b", provider: "test", subject: "b", authenticatedAt: now };
const identityC = { userId: "user-c", provider: "test", subject: "c", authenticatedAt: now };
const identityAdmin = { userId: "user-admin", provider: "test", subject: "admin", authenticatedAt: now };
const identityApplicant = { userId: "user-applicant", provider: "test", subject: "applicant", authenticatedAt: now };
const basePrivacy = { presenceSharingEnabled: true, locationVisibility: "team-only", preciseLocationAllowed: true, shareSpeed: true, shareHeading: true, delaySeconds: 900 };
const makeMember = (memberId, authenticatedUserId, teamId, roles = ["verified-chaser"], privacy = basePrivacy) => ({
  memberId,
  authenticatedUserId,
  displayName: memberId,
  callsign: memberId.toUpperCase(),
  teamId,
  team: teamId,
  membershipState: "active",
  roles,
  role: roles[0],
  verificationLevel: roles.includes("admin") ? "admin" : "chaser",
  verificationBadges: [],
  avatarRef: null,
  vehicleUnitName: null,
  homeRegion: null,
  createdAt: now,
  lastActiveAt: null,
  status: "off-duty",
  moderationState: "clear",
  privacy,
  publicProfileVisible: false,
  trustedProfileVisible: true,
});
const backend = new chaserNet.InMemoryChaserNetBackend({
  members: [
    makeMember("member-a", "user-a", "team-1"),
    makeMember("member-b", "user-b", "team-1"),
    makeMember("member-c", "user-c", "team-2"),
    makeMember("member-admin", "user-admin", "team-admin", ["admin"]),
  ],
}, { currentMs: 24 * 60 * 60_000, agingMs: 48 * 60 * 60_000, staleMs: 72 * 60 * 60_000 });
const applicationDraft = backend.saveApplicationDraft(identityApplicant, {
  publicProfile: {
    displayName: "Test Applicant",
    callsign: "TEST-1",
    teamAffiliation: null,
    chaseWeatherProfileLinks: ["https://example.test/chase"],
  },
  internalReview: {
    legalName: "Internal Only",
    chaseSpotterExperience: "Several seasons of storm spotting and basic radar awareness.",
    skywarnTraining: "SKYWARN basic",
    spotterNetworkId: "SN123",
    references: ["Known team reference"],
    codeOfConductAcceptedAt: null,
  },
});
assert.equal(applicationDraft.decisionStatus, "draft");
assert.throws(() => backend.submitApplication(identityApplicant), /CHASER_NET_CODE_OF_CONDUCT_REQUIRED/);
backend.saveApplicationDraft(identityApplicant, {
  ...applicationDraft,
  internalReview: {
    ...applicationDraft.internalReview,
    codeOfConductAcceptedAt: now,
  },
});
const submittedApplication = backend.submitApplication(identityApplicant);
assert.equal(submittedApplication.decisionStatus, "submitted");
assert.throws(() => backend.listApplicationsForReview(identityA), /CHASER_NET_PERMISSION_DENIED/);
assert.equal(backend.listApplicationsForReview(identityAdmin).length, 1);
assert.throws(() => backend.reviewApplication(identityA, submittedApplication.applicationId, { decisionStatus: "approved", reviewerNote: "not allowed" }), /CHASER_NET_PERMISSION_DENIED/);
const reviewedApplication = backend.reviewApplication(identityAdmin, submittedApplication.applicationId, {
  decisionStatus: "approved",
  reviewerNote: "Approved for probationary access after review.",
  approvedRole: "probationary",
  approvedMembershipState: "probationary",
});
assert.equal(reviewedApplication.decisionStatus, "approved");
assert.equal(backend.getStatus(identityApplicant).member?.membershipState, "probationary");
const snapshotBackend = chaserNet.createChaserNetBackendFromSnapshot(backend.toSnapshot());
assert.equal(snapshotBackend.getStatus(identityApplicant).member?.callsign, "TEST-1");
assert.ok(snapshotBackend.getAuditEvents().some((event) => event.action === "application.reviewed"));

const presenceLocation = {
  lat: 36.42,
  lon: -94.2,
  horizontalAccuracyM: 12,
  altitudeM: null,
  altitudeAccuracyM: null,
  speedMps: 8,
  speedAccuracyMps: null,
  headingDeg: 220,
  headingAccuracyDeg: null,
  provider: "gps",
  quality: "good",
};
backend.submitPresence(identityB, { memberId: "member-b", state: "active-chase", currentSessionId: "chase-1", timestampUtc: now, location: presenceLocation });
const permittedPresence = backend.getPresenceForViewport({ identity: identityA, viewport: testViewport, detail: "close", sessionId: null });
assert.equal(permittedPresence.data.length, 1);
const deniedPresence = backend.getPresenceForViewport({ identity: identityC, viewport: testViewport, detail: "close", sessionId: null });
assert.equal(deniedPresence.data.length, 0);
assert.throws(() => backend.submitPresence(null, { memberId: "member-a", state: "active-chase", currentSessionId: null, timestampUtc: now, location: presenceLocation }), /CHASER_NET_AUTH_REQUIRED/);
assert.throws(() => backend.submitPresence(identityB, { memberId: "member-b", state: "active-chase", currentSessionId: "chase-1", timestampUtc: now + 1_000, location: presenceLocation }), /CHASER_NET_PRESENCE_RATE_LIMITED/);

const report = backend.createReport(identityB, {
  reporterMemberId: "member-b",
  chaseSessionId: "chase-1",
  timestampUtc: now,
  lat: 36.43,
  lon: -94.21,
  horizontalAccuracyM: 15,
  category: "wall-cloud",
  text: "Persistent lowering west of town",
  confidence: "medium",
  visibility: "team-only",
});
assert.equal(report.provenance.provider, "CHASERNET/HUMAN");
assert.equal(report.verificationState, "unverified");
assert.equal(backend.getReportsForViewport({ identity: identityA, viewport: testViewport, detail: "close", sessionId: null }).data.length, 1);
assert.equal(backend.getReportsForViewport({ identity: identityC, viewport: testViewport, detail: "close", sessionId: null }).data.length, 0);
assert.throws(() => backend.createReport(identityB, { reporterMemberId: "member-b", chaseSessionId: null, timestampUtc: now, lat: 136, lon: -94, horizontalAccuracyM: null, category: "hail", text: "bad coord", confidence: "low", visibility: "trusted-network" }), /CHASER_NET_INVALID_COORDINATE/);
assert.throws(() => backend.updateReport(identityB, report.reportId, { verificationState: "moderator-reviewed" }), /CHASER_NET_PERMISSION_DENIED/);
const retracted = backend.retractReport(identityB, report.reportId);
assert.equal(retracted.updateState, "retracted");
assert.equal(backend.getReportsForViewport({ identity: identityA, viewport: testViewport, detail: "close", sessionId: null }).data.length, 0);
assert.ok(backend.getAuditEvents().some((event) => event.action === "report.retracted"));

const unavailableRoads = layerManager.notConfiguredLayer("road-conditions", "Road Conditions");
assert.equal(unavailableRoads.availability, "unavailable");
assert.equal(layerManager.layerCanRender(unavailableRoads), false);
assert.deepEqual(layerManager.sortOperationalLayers([{ order: 3 }, { order: 1 }]).map((item) => item.order), [1, 3]);
assert.equal(layerManager.clampLayerOpacity(2), 1);
assert.equal(layerManager.clampLayerOpacity(-1), 0);

const missingGpsContext = egress.createEgressContext({ chaseSessionId: "test", currentPosition: null, now: 1 });
assert.equal(egress.summarizeEgressReadiness(missingGpsContext).state, "UNAVAILABLE");
const routeScore = egress.scoreCandidateRoute({
  id: "r1",
  label: "Candidate",
  distanceMiles: null,
  travelTimeMinutes: null,
  directionHint: null,
  inputStates: [{ kind: "radar-threat", state: "STALE", message: "Radar stale", updatedAt: null, provenance: null }],
});
assert.equal(routeScore.usable, false);
assert.equal(routeScore.confidence, "DEGRADED");

assert.equal(locationObservation.classifyLocationQuality({ latitude: 36, longitude: -94, horizontalAccuracyM: 12, timestampUtc: now, now }), "good");
assert.equal(locationObservation.classifyLocationQuality({ latitude: 36, longitude: -94, horizontalAccuracyM: 250, timestampUtc: now, now }), "degraded");
assert.equal(locationObservation.classifyLocationQuality({ latitude: 36, longitude: -94, horizontalAccuracyM: 12, timestampUtc: now - 10 * 60_000, now }), "stale");
assert.equal(locationObservation.classifyLocationQuality({ latitude: Number.NaN, longitude: -94, horizontalAccuracyM: 12, timestampUtc: now, now }), "invalid");

const baseObs = locationObservation.createLocationObservation({
  sessionId: "chase-a",
  latitude: 36,
  longitude: -94,
  horizontalAccuracyM: 30,
  timestampUtc: now,
  receivedAt: now,
  storedAt: now,
});
const nearDuplicate = locationObservation.createLocationObservation({
  sessionId: "chase-a",
  latitude: 36.00001,
  longitude: -94.00001,
  horizontalAccuracyM: 35,
  timestampUtc: now + 5_000,
  receivedAt: now + 5_000,
  storedAt: now + 5_000,
});
const improvedAccuracy = locationObservation.createLocationObservation({
  sessionId: "chase-a",
  latitude: 36.00001,
  longitude: -94.00001,
  horizontalAccuracyM: 10,
  timestampUtc: now + 5_000,
  receivedAt: now + 5_000,
  storedAt: now + 5_000,
});
const movedObs = locationObservation.createLocationObservation({
  sessionId: "chase-a",
  latitude: 36.001,
  longitude: -94.001,
  horizontalAccuracyM: 35,
  timestampUtc: now + 5_000,
  receivedAt: now + 5_000,
  storedAt: now + 5_000,
});
assert.ok(baseObs);
assert.ok(nearDuplicate);
assert.ok(improvedAccuracy);
assert.ok(movedObs);
const balancedPolicy = locationObservation.trackingPresetPolicy("balanced");
assert.equal(locationObservation.shouldKeepLocationObservation(baseObs, nearDuplicate, balancedPolicy), false);
assert.equal(locationObservation.shouldKeepLocationObservation(baseObs, improvedAccuracy, balancedPolicy), true);
assert.equal(locationObservation.shouldKeepLocationObservation(baseObs, movedObs, balancedPolicy), true);
assert.deepEqual(locationObservation.trackingPresetPolicy("battery-saver"), { minDistanceM: 40, minElapsedMs: 120_000 });

console.log("pass1-domain-tests: ok");
