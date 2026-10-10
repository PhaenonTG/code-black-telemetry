const assert = require("node:assert/strict");
const test = require("node:test");
const { ChaseRadarController } = require("../chaseControl.cjs");
const { ChaseRadarScheduler } = require("../chaseScheduler.cjs");

const now = 1_000_000;
const sites = [
  { id: "KSGF", lat: 37.2352, lon: -93.4006 }, { id: "KTLX", lat: 35.3331, lon: -97.2778 },
  { id: "KICT", lat: 37.6546, lon: -97.4431 }, { id: "KLSX", lat: 38.6987, lon: -90.6828 },
];
const snapshot = { units: [
  { unit_id: "striker", role: "lead-chase-platform", overall_health: "LIVE", last_seen: now - 3_000, location: { lat: 37.2, lon: -93.4 } },
  { unit_id: "tessa", role: "chase-platform", overall_health: "LIVE", last_seen: now - 5_000, location: { lat: 35.3, lon: -97.3 } },
] };

function controller() { return new ChaseRadarController({ radarSites: sites, nowMs: () => now }); }

test("observer mode reports selected primary and secondary sites without fetching", async () => {
  const calls = [];
  const scheduler = new ChaseRadarScheduler({ controller: controller(), prewarm: async (item) => calls.push(item), nowMs: () => now });
  const status = await scheduler.observe(snapshot);
  assert.equal(status.mode, "OBSERVER");
  assert.equal(calls.length, 0);
  assert.deepEqual(status.selection.primary.map((item) => item.site_id).sort(), ["KSGF", "KTLX"]);
  assert.equal(status.selection.secondary.length, 1);
  assert.equal(JSON.stringify(status).includes("37.2"), false);
});

test("active mode completes primary prewarms before the bounded secondary", async () => {
  const calls = [];
  const scheduler = new ChaseRadarScheduler({ controller: controller(), mode: "ACTIVE", nowMs: () => now,
    prewarm: async (item) => calls.push(`${item.priority}:${item.siteId}`) });
  const status = await scheduler.observe(snapshot);
  assert.equal(calls.length, 3);
  assert.ok(calls.slice(0, 2).every((item) => item.startsWith("PRIMARY:")));
  assert.ok(calls[2].startsWith("SECONDARY:"));
  assert.equal(status.state, "READY");
});

test("a failed primary prevents opportunistic secondary prewarming", async () => {
  const calls = [];
  const scheduler = new ChaseRadarScheduler({ controller: controller(), mode: "ACTIVE", nowMs: () => now,
    prewarm: async (item) => { calls.push(`${item.priority}:${item.siteId}`); if (item.priority === "PRIMARY") throw new TypeError("network"); } });
  const status = await scheduler.observe(snapshot);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((item) => item.startsWith("PRIMARY:")));
  assert.equal(status.state, "DEGRADED");
  assert.equal(status.work.last_error, "PREWARM_TYPEERROR");
});
