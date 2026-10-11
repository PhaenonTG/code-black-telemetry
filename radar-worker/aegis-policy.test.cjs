const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { initPolicy, createDraft, rollbackDraft, policyStatus, replayScenario,
  replayRecorded } = require("./aegis-policy.cjs");

test("draft and rollback append audited revisions without changing live config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-policy-test-"));
  const live = { enabled: true, delivery_enabled: false, evidence_cutoff: 85 };
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(live));
  try {
    assert.equal(initPolicy(dir, live).revision, 1);
    assert.equal(createDraft(dir, 92, "operator", 1).revision, 2);
    assert.throws(() => createDraft(dir, 91, "operator", 1), /stale policy revision/);
    const rolled = rollbackDraft(dir, 1, "operator", 2);
    assert.equal(rolled.revision, 3);
    assert.equal(rolled.evidence_cutoff, 85);
    const status = policyStatus(dir, live);
    assert.equal(status.current_draft.revision, 3);
    assert.equal(status.activation_locked, true);
    assert.equal(status.live.delivery_enabled, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8")), live);
    assert.equal(fs.readFileSync(path.join(dir, "policy-drafts.jsonl"), "utf8").trim().split("\n").length, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("scenario replay is a dry-run with all routing gates", () => {
  const input = { warning: "Tornado Warning", candidateAvailable: true, evidenceScore: 92,
    evidenceCutoff: 85, scanAgeMinutes: 4, deliveryEnabled: true };
  const routed = replayScenario(input);
  assert.equal(routed.decision, "WOULD_ROUTE");
  assert.equal(routed.no_messages_sent, true);
  assert.equal(replayScenario({ ...input, deliveryEnabled: false }).decision, "SHADOW");
  assert.equal(replayScenario({ ...input, evidenceScore: 70 }).decision, "BELOW_CUTOFF");
  assert.equal(replayScenario({ ...input, scanAgeMinutes: 16 }).decision, "STALE");
  assert.equal(replayScenario({ ...input, candidateAvailable: false }).decision, "NO_CANDIDATE");
  assert.throws(() => replayScenario({ ...input, evidenceCutoff: 0 }), /cutoff/);
});

test("recorded scan replay uses captured evidence and does not publish", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-recorded-test-"));
  const record = { site: "KRAX", key: "volume-1", scanTime: "2026-10-11T17:58:00Z",
    processedAt: "2026-10-11T18:00:00Z", analyzedTilt: 1,
    elevationSeparationDeg: 0.1, tiltAvailability: [{ tilt: 1, elevationAngle: 0.5 }],
    availableProducts: { REF: true, VEL: true, CC: true, ZDR: true },
    radarLimitations: ["Synthetic test fixture"], candidates: [{
      warningId: "https://api.weather.gov/alerts/example", coordinates: [-78.5, 35.75],
      temporallyPersistent: true, rangeKm: 20, shearKt: 63,
      reflectivityDbz: 42, cc: 0.78, zdrDb: 0.3,
    }] };
  fs.writeFileSync(path.join(dir, "scans.jsonl"), JSON.stringify(record) + "\n");
  try {
    const result = replayRecorded(dir, { evidence_cutoff: 85, delivery_enabled: false },
      { evidenceCutoff: 100, limit: 10 });
    assert.equal(result.scans_reviewed, 1);
    assert.equal(result.scans[0].candidates[0].decision, "WOULD_QUALIFY");
    assert.equal(result.no_messages_sent, true);
    assert.equal(fs.existsSync(path.join(dir, "alerts.jsonl")), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
