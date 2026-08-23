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
const platformCapabilityModel = await importTs("src/services/platformCapabilityModel.ts");
const connection = await importTs("src/services/connection.ts");
const roadCameraProviders = await importTs("src/services/roadCameraProviders.ts");
const liveOverlayTelemetry = await importTs("src/services/liveOverlayTelemetryModel.ts");
const credentialSecurity = await importTs("src/services/credentialSecurity.ts");
const spotterSubmissionPolicy = await importTs("src/services/spotterSubmissionPolicy.ts");

const appSource = await readFile("src/App.tsx", "utf8");
assert.match(
  appSource,
  /function appPageSupportsOperationalActions\(page: PageKey\) \{\s*return page === "locate";\s*\}/,
  "MARK/ESCAPE operational controls must remain Locate/map-only",
);

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
}, { currentMs: Number.MAX_SAFE_INTEGER, agingMs: Number.MAX_SAFE_INTEGER, staleMs: Number.MAX_SAFE_INTEGER });
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

const roadCameraTest = roadCameraProviders.__roadCameraProviderTest;
assert.equal(roadCameraTest.isValidCoordinate(36, -94), true);
assert.equal(roadCameraTest.isValidCoordinate(136, -94), false);
assert.equal(roadCameraTest.safeHttpUrl("javascript:alert(1)"), null);
assert.equal(roadCameraTest.safeHttpUrl("https://example.test/camera#token"), "https://example.test/camera");
assert.equal(roadCameraTest.sanitizeProviderText("<b>Flooded</b> road\nnear bridge"), "Flooded road near bridge");
assert.equal(roadCameraTest.freshnessForTimestamp(now - 2 * 60_000, now), "fresh");
assert.equal(roadCameraTest.freshnessForTimestamp(now - 30 * 60_000, now), "aging");
assert.equal(roadCameraTest.freshnessForTimestamp(now - 2 * 60 * 60_000, now), "stale");
assert.equal(roadCameraProviders.roadProvidersForViewport(testViewport).some((provider) => provider.id === "ardot-idrive"), true);
assert.equal(roadCameraProviders.trafficCameraProvidersForViewport(testViewport).some((provider) => provider.id === "ardot-idrive"), true);
const outsideArkansasViewport = { north: 40, south: 39, east: -100, west: -101, zoom: 8 };
assert.equal(roadCameraProviders.roadProvidersForViewport(outsideArkansasViewport).length, 0);
const normalizedRoad = roadCameraTest.normalizeRoadFeature({
  properties: {
    gid: 123,
    reason_name: "Flooding",
    description: "Water over roadway",
    travel_direction_name: "Both",
    route_type: "State Highway",
    route: "59",
    lanes: ["All"],
    updated_date: "2026-08-18T12:00:00Z",
  },
  geometry: { type: "Point", coordinates: [-94.1, 36.2] },
}, "test-provider", "closure");
assert.ok(normalizedRoad);
assert.equal(normalizedRoad.kind, "flooding");
assert.equal(normalizedRoad.closureState, "closed");
assert.equal(normalizedRoad.providerRecordId, "123");
assert.equal(roadCameraTest.normalizeRoadFeature({ properties: { gid: 1 }, geometry: { type: "Point", coordinates: [-194, 36] } }, "test-provider", "closure"), null);
const normalizedCamera = roadCameraTest.normalizeCameraFeature({
  properties: {
    id: 44,
    status: "online",
    name: "I-49 at Test",
    direction_name: "North",
    route_type: "Interstate",
    route: "49",
    hls_stream_protected: "https://example.test/feed.m3u8",
  },
  geometry: { type: "Point", coordinates: [-94.2, 36.3] },
}, "test-provider");
assert.ok(normalizedCamera);
assert.equal(normalizedCamera.availability, "available");
assert.equal(normalizedCamera.streamUrl, "https://example.test/feed.m3u8");
assert.equal(roadCameraTest.normalizeCameraFeature({ properties: { id: 2 }, geometry: { type: "Point", coordinates: [-94, Number.NaN] } }, "test-provider"), null);

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

const androidCapabilities = platformCapabilityModel.capabilitiesForRuntime({ platform: "android", nativeRuntime: true, wakeLockSupported: false });
assert.equal(platformCapabilityModel.platformSupportsPersistentChaseTracking(androidCapabilities), true);
assert.equal(androidCapabilities.nativePersistentLocation, true);
assert.equal(androidCapabilities.notifications, true);
assert.equal(androidCapabilities.nativeNotifications, true);
const iosCapabilities = platformCapabilityModel.capabilitiesForRuntime({ platform: "ios", nativeRuntime: true, wakeLockSupported: false });
assert.equal(platformCapabilityModel.platformSupportsPersistentChaseTracking(iosCapabilities), false);
assert.equal(iosCapabilities.nativePersistentLocation, false);
assert.equal(iosCapabilities.notifications, false);
assert.equal(iosCapabilities.nativeNotifications, false);
assert.equal(iosCapabilities.ble, true);
const webCapabilities = platformCapabilityModel.capabilitiesForRuntime({ platform: "web", nativeRuntime: false, wakeLockSupported: true });
assert.equal(platformCapabilityModel.platformSupportsPersistentChaseTracking(webCapabilities), false);
assert.equal(webCapabilities.notifications, true);
assert.equal(webCapabilities.nativeNotifications, false);
assert.equal(webCapabilities.wakeLock, true);
assert.equal(webCapabilities.desktopNotifications, true);

assert.equal(connection.normalizeEndpointInput("192.168.4.1:5000").endpoint, "http://192.168.4.1:5000");
assert.equal(connection.normalizeEndpointInput(" http://raspberrypi.local:5000/ ").endpoint, "http://raspberrypi.local:5000");
assert.equal(connection.normalizeEndpointInput("https://core.example.com/api/").endpoint, "https://core.example.com/api");
assert.equal(connection.normalizeEndpointInput("javascript:alert(1)").ok, false);
assert.equal(connection.normalizeEndpointInput("http://user:pass@192.168.4.1").errorCode, "INVALID_ENDPOINT");
assert.equal(connection.inferConnectionTransport("http://192.168.4.1:5000"), "local-network");
assert.equal(connection.inferConnectionTransport("http://100.80.136.32:5000"), "tailscale");
assert.equal(connection.classifyHttpStatus(401).lastErrorCode, "AUTH_REQUIRED");
assert.equal(connection.classifyHttpStatus(403).lastErrorCode, "AUTH_FAILED");
assert.equal(connection.classifyHttpStatus(503).connectionState, "DEGRADED");
assert.equal(connection.classifyFetchError(new DOMException("The operation was aborted.", "AbortError")).lastErrorCode, "TIMEOUT");
assert.equal(connection.dataFreshnessState(now - 5_000, now, 30_000, 180_000), "CONNECTED");
assert.equal(connection.dataFreshnessState(now - 60_000, now, 30_000, 180_000), "STALE");
assert.equal(connection.dataFreshnessState(now - 5 * 60_000, now, 30_000, 180_000), "DISCONNECTED");
const backoffA = connection.nextBackoffDelayMs(1, { baseMs: 1000, maxMs: 30_000, jitterRatio: 0 });
const backoffB = connection.nextBackoffDelayMs(5, { baseMs: 1000, maxMs: 30_000, jitterRatio: 0 });
assert.equal(backoffA, 1000);
assert.equal(backoffB, 16000);
const configuredStatus = connection.createConnectionStatus({ endpoint: "http://192.168.4.1:5000", provider: "vehicle-node" });
assert.equal(configuredStatus.isConfigured, true);
assert.equal(configuredStatus.transport, "local-network");
assert.equal(configuredStatus.connectionState, "DISCONNECTED");

const overlayNow = Date.parse("2026-08-22T18:00:00Z");
const overlayPayload = {
  stationId: "cbwx-001",
  sessionId: "chase-20260822180000-test",
  timestamp: overlayNow,
  latitude: 36.18,
  longitude: -94.12,
  accuracyM: 8,
  speedMps: 14,
  headingDeg: 224,
  source: "CODEBLACK_OPS",
};
const validatedOverlay = liveOverlayTelemetry.validateLiveOverlayTelemetryPayload(overlayPayload, overlayNow);
assert.equal(validatedOverlay.ok, true);
assert.equal(validatedOverlay.payload.stationId, "CBWX-001");
assert.equal(liveOverlayTelemetry.validateLiveOverlayTelemetryPayload({ ...overlayPayload, latitude: 136 }, overlayNow).errorCode, "INVALID_COORDINATE");
assert.equal(liveOverlayTelemetry.validateLiveOverlayTelemetryPayload({ ...overlayPayload, timestamp: overlayNow - 120_000 }, overlayNow).errorCode, "STALE_PACKET");
assert.equal(liveOverlayTelemetry.validateLiveOverlayTelemetryPayload({ ...overlayPayload, source: "CHASERNET" }, overlayNow).errorCode, "INVALID_SOURCE");
const overlayStore = new liveOverlayTelemetry.LiveOverlayTelemetryLatestStore([
  { stationId: "CBWX-001", stationName: "Spencer", token: "test-token" },
  { stationId: "CBWX-002", stationName: "Nick", token: "nick-token" },
]);
assert.equal(overlayStore.ingest(null, overlayPayload, overlayNow).errorCode, "AUTH_REQUIRED");
assert.equal(overlayStore.ingest("Bearer wrong", overlayPayload, overlayNow).errorCode, "AUTH_FAILED");
const ingestResult = overlayStore.ingest("Bearer test-token", overlayPayload, overlayNow);
assert.equal(ingestResult.accepted, true);
assert.equal(overlayStore.read("CBWX-001", overlayNow + 5_000).snapshot.freshness, "live");
assert.equal(overlayStore.read("CBWX-001", overlayNow + 20_000).snapshot.freshness, "aging");
assert.equal(overlayStore.read("CBWX-001", overlayNow + 60_000).snapshot.freshness, "stale");
assert.equal(overlayStore.read("CBWX-001", overlayNow + 120_000).snapshot.freshness, "offline");
assert.equal(overlayStore.read("CBWX-002", overlayNow).found, false);
const olderOverlay = overlayStore.ingest("Bearer test-token", { ...overlayPayload, timestamp: overlayNow - 5_000 }, overlayNow);
assert.equal(olderOverlay.accepted, false);
assert.equal(olderOverlay.errorCode, "OLDER_PACKET");
const movedOverlay = { ...overlayPayload, timestamp: overlayNow + 3_000, latitude: 36.181 };
assert.equal(liveOverlayTelemetry.shouldPublishLiveOverlayTelemetry(null, overlayPayload, null, overlayNow).publish, true);
assert.equal(liveOverlayTelemetry.shouldPublishLiveOverlayTelemetry(overlayPayload, { ...overlayPayload, timestamp: overlayNow + 1_000 }, overlayNow, overlayNow + 1_000).publish, false);
assert.equal(liveOverlayTelemetry.shouldPublishLiveOverlayTelemetry(overlayPayload, movedOverlay, overlayNow, overlayNow + 3_000).reason, "movement");
assert.equal(
  liveOverlayTelemetry.shouldPublishLiveOverlayTelemetry(overlayPayload, { ...overlayPayload, timestamp: overlayNow + 3_000, headingDeg: 260 }, overlayNow, overlayNow + 3_000).reason,
  "heading",
);
assert.equal(
  liveOverlayTelemetry.shouldPublishLiveOverlayTelemetry(overlayPayload, { ...overlayPayload, timestamp: overlayNow + 6_000 }, overlayNow, overlayNow + 6_000).reason,
  "elapsed",
);
assert.equal(liveOverlayTelemetry.createLiveOverlayIngestUrl("https://core.example.test/"), "https://core.example.test/api/telemetry/live/location");
assert.equal(liveOverlayTelemetry.createLiveOverlayReadUrl("https://core.example.test/", "cbwx-001"), "https://core.example.test/api/telemetry/live/CBWX-001");

assert.equal(credentialSecurity.isKnownCredentialKey("spotter-network.password"), true);
assert.equal(credentialSecurity.isKnownCredentialKey("codeblack.bleCommandToken"), false);
assert.equal(credentialSecurity.normalizeCredentialValue("  test-token  "), "test-token");
assert.equal(credentialSecurity.credentialConfiguredLabel(true), "CONFIGURED");
assert.equal(credentialSecurity.redactCredentialText("Authorization: Bearer secret-token"), "Authorization: Bearer [REDACTED]");
assert.deepEqual(
  credentialSecurity.redactCredentialRecord({ nested: { stationToken: "secret", endpoint: "https://core.example.test" } }),
  { nested: { stationToken: "[REDACTED]", endpoint: "https://core.example.test" } },
);
const migrationOk = credentialSecurity.credentialMigrationResult(true, true);
assert.equal(migrationOk.migrated, true);
assert.equal(migrationOk.removedLegacy, true);
const migrationPreserved = credentialSecurity.credentialMigrationResult(true, false, "token=secret");
assert.equal(migrationPreserved.preservedLegacy, true);
assert.equal(migrationPreserved.error.includes("secret"), false);

const spotterSubmission = {
  reportType: "S",
  tornado: false,
  funnelCloud: false,
  wallCloud: true,
  rotation: false,
  hail: false,
  wind: false,
  flood: false,
  flashFlood: false,
  other: false,
  hailSizeIn: null,
  windSpeedMph: null,
  windMeasured: false,
  damage: false,
  injury: false,
  narrative: "Wall cloud west of town",
  lat: 36.18,
  lon: -94.12,
};
assert.equal(spotterSubmissionPolicy.validateSpotterSubmission(spotterSubmission), "");
assert.equal(spotterSubmissionPolicy.validateSpotterSubmission({ ...spotterSubmission, lat: 136 }), "Report location is invalid.");
assert.equal(spotterSubmissionPolicy.validateSpotterSubmission({ ...spotterSubmission, wallCloud: false }), "Select at least one hazard type.");
assert.equal(spotterSubmissionPolicy.validateSpotterSubmission({ ...spotterSubmission, narrative: "x".repeat(501) }), "Report narrative must be 500 characters or less.");
const reportFingerprintA = spotterSubmissionPolicy.spotterReportFingerprint("123", spotterSubmission);
const reportFingerprintB = spotterSubmissionPolicy.spotterReportFingerprint("123", { ...spotterSubmission, lat: 36.18001, lon: -94.12001 });
assert.equal(reportFingerprintA, reportFingerprintB);
const ledger = spotterSubmissionPolicy.upsertSpotterSubmissionLedger({ entries: [] }, reportFingerprintA, "UNKNOWN", now);
assert.equal(ledger.entries[0].state, "UNKNOWN");
const submittedLedger = spotterSubmissionPolicy.upsertSpotterSubmissionLedger(ledger, reportFingerprintA, "SUBMITTED", now + 1);
assert.equal(submittedLedger.entries.length, 1);
assert.equal(submittedLedger.entries[0].state, "SUBMITTED");
assert.equal(/submitSevereReport/.test(await readFile("src/services/markEvents.ts", "utf8")), false);
assert.equal(/submitSevereReport/.test(await readFile("src/services/chaserNet.ts", "utf8")), false);

console.log("pass1-domain-tests: ok");
