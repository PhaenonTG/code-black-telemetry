const test = require("node:test");
const assert = require("node:assert/strict");
const { candidatesFrom, inPolygon } = require("./krax-watch.cjs");

function row(value) {
  return { first_gate: 0, gate_size: 1, moment_data: Array(151).fill(value) };
}

test("warning polygon containment excludes holes", () => {
  const geometry = { type: "Polygon", coordinates: [
    [[-80, 34], [-77, 34], [-77, 37], [-80, 37], [-80, 34]],
    [[-79, 35], [-78, 35], [-78, 36], [-79, 36], [-79, 35]],
  ] };
  assert.equal(inPolygon([-78.5, 35.5], geometry), false);
  assert.equal(inPolygon([-79.5, 35.5], geometry), true);
});

test("TDS stays unasserted without prior colocated low CC and strong REF", () => {
  const t = "2026-10-11T16:14:23Z";
  const products = { VEL: [row(22), row(-22)], REF: [row(42), row(42)],
    CC: [row(0.75), row(0.75)], ZDR: null, SW: null };
  const one = candidatesFrom(null, products, [0, 1], [], t, { features: [] });
  assert.ok(one.length);
  assert.equal(one[0].classification, "single_scan_couplet");
  assert.equal(one[0].potentialTds, null);
  const prior = [{ coordinates: one[0].coordinates, scanTime: "2026-10-11T16:07:01Z", lowCcReflectivity: false }];
  const two = candidatesFrom(null, products, [0, 1], prior, t, { features: [] });
  assert.equal(two[0].potentialTds, null);
  prior[0].lowCcReflectivity = true;
  const three = candidatesFrom(null, products, [0, 1], prior, t, { features: [] });
  assert.equal(three[0].potentialTds, "candidate_only_requires_human_review");
  assert.equal(three[0].classification, "candidate_low_level_rotation");
});
