// V1 radar-intelligence pass: coverage for stormCentroid()'s additive maxDbz/maxDbzLocation
// fields and estimateStormMotion()'s additive location/maxDbz/observedAt/id fields.
// Pure-function tests against synthetic frames -- no network, no S3, no real decode.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const worker = require("./worker.cjs");

const SITE = { id: "TEST", name: "TEST SITE", lat: 35.0, lon: -95.0 };

// One radial due east (azimuth 90) with a single in-threshold gate at ~50km range.
function refFrame({ time, rangeKm, dbz, azimuthDeg = 90 }) {
  return {
    id: `frame-${time}`,
    site: SITE,
    product: "REF",
    time,
    data: [{
      first_gate: rangeKm,
      gate_size: 1,
      moment_data: Float32Array.from([dbz]),
    }],
    azimuths: [azimuthDeg],
  };
}

test("stormCentroid returns null for a non-REF frame", () => {
  const frame = refFrame({ time: 0, rangeKm: 50, dbz: 45 });
  frame.product = "VEL";
  assert.equal(worker.stormCentroid(frame), null);
});

test("stormCentroid returns null when no gate reaches the threshold", () => {
  const frame = refFrame({ time: 0, rangeKm: 50, dbz: 10 }); // below STORM_CENTROID_DBZ_THRESHOLD (35)
  assert.equal(worker.stormCentroid(frame), null);
});

test("stormCentroid reports the real max-dBZ gate value and an east-of-site location", () => {
  const frame = refFrame({ time: 0, rangeKm: 50, dbz: 55 });
  const centroid = worker.stormCentroid(frame);
  assert.ok(centroid, "expected a centroid for an in-threshold gate");
  assert.equal(centroid.maxDbz, 55, "maxDbz must be the literal gate value, not derived/blended");
  assert.ok(centroid.lon > SITE.lon, "single due-east gate must produce an east-of-site centroid");
  assert.ok(centroid.maxDbzLon > SITE.lon, "max-dBZ core location must also be east of the site");
});

test("estimateStormMotion is honest (ok:false) with fewer than two REF frames", () => {
  worker.frames.clear();
  const only = refFrame({ time: Date.now(), rangeKm: 50, dbz: 45 });
  worker.frames.set(only.id, only);
  const result = worker.estimateStormMotion(SITE.id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "NEED_TWO_REF_FRAMES");
  worker.frames.clear();
});

test("estimateStormMotion surfaces location/maxDbz/observedAt/id for two separated frames", () => {
  worker.frames.clear();
  const now = Date.now();
  const baseline = refFrame({ time: now - 10 * 60_000, rangeKm: 50, dbz: 45 });
  const newest = refFrame({ time: now, rangeKm: 60, dbz: 58 }); // moved farther east, intensified
  worker.frames.set(baseline.id, baseline);
  worker.frames.set(newest.id, newest);

  const result = worker.estimateStormMotion(SITE.id);
  assert.equal(result.ok, true);
  assert.equal(result.id, `${SITE.id}-primary`);
  assert.equal(result.maxDbz, 58, "must reflect the NEWEST frame's core, not the baseline's");
  assert.equal(result.observedAt, new Date(newest.time).toISOString(), "must be the newest frame's real scan time, never wall-clock now");
  assert.ok(result.location.lon > SITE.lon);
  assert.ok(result.maxDbzLocation.lon > SITE.lon);
  assert.equal(typeof result.directionDegrees, "number");
  assert.equal(typeof result.speedKnots, "number");
  worker.frames.clear();
});
