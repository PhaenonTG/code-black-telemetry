const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate } = require("./aegis-calibration.cjs");

const base = { site: "KRAX", scanTime: "2026-10-11T17:58:00Z", processedAt: "2026-10-11T18:00:00Z",
  analyzedTilt: 1, elevationSeparationDeg: 0.1, tiltAvailability: [{ tilt: 1, elevationAngle: 0.5 }],
  availableProducts: { REF: true, VEL: true, CC: true } };
const candidate = { warningId: "https://api.weather.gov/alerts/one", temporallyPersistent: true,
  rangeKm: 20, shearKt: 63, reflectivityDbz: 42, cc: 0.78, zdrDb: 0.3 };
const label = (volume_key, truth) => ({ site: "KRAX", volume_key,
  warning_id: "https://api.weather.gov/alerts/one", truth,
  reviewer: "qualified-reviewer", source_url: "https://www.ncei.noaa.gov/example",
  reviewed_at: "2026-10-12T01:00:00Z" });

test("reports all four outcomes without claiming calibrated probability", () => {
  const scans = [
    { ...base, key: "one", candidates: [candidate] },
    { ...base, key: "two", candidates: [] },
    { ...base, key: "three", candidates: [candidate] },
    { ...base, key: "four", candidates: [] },
  ];
  const labels = [label("one", "confirmed_tornado"), label("two", "confirmed_tornado"),
    label("three", "reviewed_no_tornado"), label("four", "reviewed_no_tornado")];
  const result = evaluate(scans, labels, { evidence_cutoff: 85, delivery_enabled: false });
  assert.deepEqual(result.metrics.find((row) => row.cutoff === 85),
    { cutoff: 85, tp: 1, fp: 1, tn: 1, fn: 1, precision: 0.5, recall: 0.5 });
  assert.equal(result.delivery_unchanged, true);
  assert.equal(result.evaluable, true);
});

test("does not declare an empty or uncertain-only corpus calibrated", () => {
  assert.equal(evaluate([], [], {}).evaluable, false);
  const result = evaluate([{ ...base, key: "one", candidates: [candidate] }], [label("one", "uncertain")], {});
  assert.equal(result.evaluable, false);
  assert.equal(result.uncertain_excluded, 1);
  assert.equal(result.metrics[0].precision, null);
});

test("rejects unmatched, duplicated, or unsourced labels", () => {
  const scans = [{ ...base, key: "one", candidates: [] }];
  assert.throws(() => evaluate(scans, [label("other", "confirmed_tornado")], {}), /absent/);
  assert.throws(() => evaluate(scans, [label("one", "confirmed_tornado"), label("one", "reviewed_no_tornado")], {}), /duplicate/);
  assert.throws(() => evaluate(scans, [{ ...label("one", "confirmed_tornado"), source_url: "none" }], {}), /invalid label/);
  assert.throws(() => evaluate([{ ...scans[0], warningContext: [] }], [label("one", "confirmed_tornado")], {}), /not presented/);
});
