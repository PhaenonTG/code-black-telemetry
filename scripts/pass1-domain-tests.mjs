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

const member = {
  privacy: { preciseLocationAllowed: true, locationVisibility: "team-only" },
};
assert.equal(chaserNet.canExposePreciseChaserLocation(member, "team"), true);
assert.equal(chaserNet.canExposePreciseChaserLocation(member, "trusted"), false);
assert.equal(chaserNet.canExposePreciseChaserLocation({ privacy: { preciseLocationAllowed: false, locationVisibility: "trusted-network" } }, "trusted"), false);

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

const now = Date.parse("2026-08-18T12:00:00Z");
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
