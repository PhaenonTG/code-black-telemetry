const assert = require("node:assert/strict");
const test = require("node:test");
const { selectChaseRadarSites } = require("../chaseSelection.cjs");

const sites = [
  { id: "KSGF", lat: 37.2352, lon: -93.4006 },
  { id: "KICT", lat: 37.6546, lon: -97.4431 },
  { id: "KLSX", lat: 38.6987, lon: -90.3616 },
  { id: "KTLX", lat: 35.3331, lon: -97.2778 },
];

test("selects one nearest primary radar per fresh active chaser and bounded secondaries", () => {
  const nowMs = 1_000_000;
  const selected = selectChaseRadarSites([
    { id: "striker", health: "LIVE", location: { lat: 37.2, lon: -93.35, observedAtMs: nowMs - 5_000 } },
    { id: "tessa", health: "LIVE", location: { lat: 35.3, lon: -97.3, observedAtMs: nowMs - 5_000 } },
  ], sites, { nowMs });
  assert.deepEqual(selected.primary.map((x) => x.siteId).sort(), ["KSGF", "KTLX"]);
  assert.equal(selected.secondary.length, 1);
  assert.equal(selected.eligibleChasers.length, 2);
});

test("never schedules stale, invalid, or offline chaser locations", () => {
  const nowMs = 1_000_000;
  const selected = selectChaseRadarSites([
    { id: "stale", health: "LIVE", location: { lat: 37, lon: -93, observedAtMs: nowMs - 120_001 } },
    { id: "offline", health: "OFFLINE", location: { lat: 37, lon: -93, observedAtMs: nowMs } },
    { id: "bad", health: "LIVE", location: { lat: 99, lon: -93, observedAtMs: nowMs } },
  ], sites, { nowMs });
  assert.equal(selected.primary.length, 0);
  assert.deepEqual(selected.skippedChasers.map((x) => x.reason).sort(), ["LOCATION_STALE", "LOCATION_UNAVAILABLE", "UNIT_NOT_ACTIVE"]);
});
