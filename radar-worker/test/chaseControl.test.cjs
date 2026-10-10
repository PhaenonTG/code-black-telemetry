const assert = require("node:assert/strict");
const test = require("node:test");
const { ChaseRadarController, normalizeFabricChasers } = require("../chaseControl.cjs");

const sites = [{ id: "KSGF", lat: 37.2352, lon: -93.4006 }, { id: "KTLX", lat: 35.3331, lon: -97.2778 }, { id: "KICT", lat: 37.6546, lon: -97.4431 }];
const now = 1_000_000;

test("accepts only Fabric chase-platform units and strips coordinates from status", () => {
  const snapshot = { units: [
    { unit_id: "striker", role: "lead-chase-platform", overall_health: "LIVE", last_seen: now - 5_000, location: { latitude: 37.2, longitude: -93.4 } },
    { unit_id: "core", role: "core", overall_health: "LIVE", location: { lat: 0, lon: 0 } },
  ] };
  assert.equal(normalizeFabricChasers(snapshot).length, 1);
  const control = new ChaseRadarController({ radarSites: sites, nowMs: () => now });
  const status = control.observeFabric(snapshot);
  assert.equal(status.state, "READY");
  assert.deepEqual(status.primary.map((x) => x.siteId), ["KSGF"]);
  assert.equal(JSON.stringify(status).includes("37.2"), false);
});

test("reports degraded rather than scheduling from an absent Fabric location", () => {
  const control = new ChaseRadarController({ radarSites: sites, nowMs: () => now });
  const status = control.observeFabric({ units: [{ unit_id: "tessa", role: "chase-platform", overall_health: "LIVE", last_seen: now }] });
  assert.equal(status.state, "DEGRADED");
  assert.equal(status.primary.length, 0);
});
