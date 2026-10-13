const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { config, warning, radarSites, siteFor, evidence, run } = require("./aegis-warning.cjs");

const nowMs = Date.parse("2026-10-11T18:00:00Z");
const id = "https://api.weather.gov/alerts/test-warning";
const geometry = { type: "Polygon", coordinates: [[[-78.7, 35.5], [-78.2, 35.5],
  [-78.2, 36.0], [-78.7, 36.0], [-78.7, 35.5]]] };
const feature = { id, geometry, properties: { event: "Tornado Warning", status: "Actual",
  sent: "2026-10-11T17:55:00Z", expires: "2026-10-11T18:30:00Z" } };
const siteDoc = { features: [{ properties: { STATION_ID: "NEXRAD:KRAX", STATION_NAME: "Raleigh",
  LATITUDE: 35.6656, LONGITUDE: -78.4897, END_DATE: 253402214400000 } },
{ properties: { STATION_ID: "NEXRAD:TRDU", STATION_NAME: "TDWR",
  LATITUDE: 35.7, LONGITUDE: -78.5, END_DATE: 253402214400000 } }] };

function scan(key, persistent = false, cc = 0.78) {
  return { site: "KRAX", key, scanTime: "2026-10-11T17:58:00Z", processedAt: "2026-10-11T18:00:00Z",
    analyzedTilt: 1, elevationSeparationDeg: 0.1,
    tiltAvailability: [{ tilt: 1, elevationAngle: 0.5 }],
    availableProducts: { REF: true, VEL: true, CC: true, ZDR: true, SW: true },
    radarLimitations: ["Experimental gate-level screen"], candidates: [{
      coordinates: [-78.5, 35.75], warningId: id, scanTime: "2026-10-11T17:58:00Z",
      temporallyPersistent: persistent, rangeKm: 20, shearKt: 63,
      reflectivityDbz: 42, cc, zdrDb: 0.3, potentialTds: null,
    }] };
}

test("official active polygon is required; TDWR sites are excluded", () => {
  assert.equal(warning(feature, nowMs)?.id, id);
  assert.equal(warning({ ...feature, properties: { ...feature.properties, status: "Test" } }, nowMs), null);
  assert.equal(warning(feature, Date.parse("2026-10-11T18:31:00Z")), null);
  const sites = radarSites(siteDoc, nowMs);
  assert.deepEqual(sites.map((s) => s.id), ["KRAX"]);
  assert.equal(siteFor(warning(feature, nowMs), sites).site.id, "KRAX");
});

test("radar selection uses nearest warning edge, not polygon vertex average", () => {
  const longWarning = { geometry: { type: "Polygon", coordinates: [[
    [-100, 35], [-90, 35], [-90, 35.2], [-100, 35.2], [-100, 35],
  ]] } };
  const chosen = siteFor(longWarning, [
    { id: "WEST", lon: -95, lat: 34.5 },
    { id: "EAST", lon: -90.1, lat: 35.3 },
  ]);
  assert.equal(chosen.site.id, "EAST");
});

test("rating is supplemental, gated by freshness, persistence, and configurable cutoff", () => {
  const w = warning(feature, nowMs);
  assert.equal(evidence(scan("x", false).candidates[0], scan("x", false), w, config({ enabled: true }), nowMs), null);
  const strong = scan("x", true);
  const rating = evidence(strong.candidates[0], strong, w, config({ enabled: true }), nowMs);
  assert.equal(rating.score, 100);
  assert.equal(rating.aboveCutoff, true);
  assert.equal(evidence(strong.candidates[0], strong, w, config({ enabled: true, evidence_cutoff: 100 }), nowMs)?.aboveCutoff, true);
  strong.scanTime = "2026-10-11T17:30:00Z";
  assert.equal(evidence(strong.candidates[0], strong, w, config({ enabled: true }), nowMs), null);
  assert.throws(() => config({ evidence_cutoff: 20 }), /evidence_cutoff/);
});

test("one new volume per key, one alert per qualified candidate, restart safe", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-warning-test-"));
  const keys = ["2026/10/11/KRAX/KRAX20261011_175000_V06"];
  const params = { dir, cfg: { enabled: true }, nowMs,
    fetchWarnings: async () => [warning(feature, nowMs)], fetchSites: async () => siteDoc,
    keysForSite: async () => keys,
    analyzeVolume: async (key, prior) => scan(key, prior.length > 0) };
  try {
    const first = await run(params);
    assert.equal(first.new_volumes, 1);
    assert.equal(first.qualified_alerts, 0);
    keys.push("2026/10/11/KRAX/KRAX20261011_175800_V06");
    const second = await run(params);
    assert.equal(second.new_volumes, 1);
    assert.equal(second.qualified_alerts, 1);
    const third = await run(params);
    assert.equal(third.new_volumes, 0);
    assert.equal(third.qualified_alerts, 0);
    const alert = JSON.parse(fs.readFileSync(path.join(dir, "alerts.jsonl"), "utf8").trim());
    assert.equal(alert.rating.calibrated_probability, null);
    assert.equal(alert.candidate.tdsConfirmed, false);
    assert.equal(alert.map.features[1].geometry.type, "Point");
    assert.equal(fs.readFileSync(path.join(dir, "scans.jsonl"), "utf8").trim().split("\n").length, 2);
    const firstScan = JSON.parse(fs.readFileSync(path.join(dir, "scans.jsonl"), "utf8").trim().split("\n")[0]);
    assert.deepEqual(firstScan.warningContext.map((item) => item.id), [id]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
