// Core-local Aegis policy drafts and side-effect-free replay. The journal is
// append-only; no command in this module edits the live scanner config.
const fs = require("node:fs");
const path = require("node:path");
const { config, scoreRecordedEvidence } = require("./aegis-warning.cjs");

const JOURNAL = "policy-drafts.jsonl";
const MAX_JOURNAL_BYTES = 1024 * 1024;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const WARNING_TYPES = new Set(["Tornado Warning", "Severe Thunderstorm Warning"]);

function fail(message) { throw new Error(message); }
function cutoff(value) {
  if (!Number.isInteger(value) || value < 70 || value > 100) fail("cutoff must be an integer from 70 through 100");
  return value;
}
function actorName(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9@._-]{2,80}$/.test(value)) fail("invalid local actor label");
  return value;
}
function readLines(file, maxBytes) {
  let data;
  try { data = fs.readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (Buffer.byteLength(data) > maxBytes) fail("journal requires archive before replay");
  if (data && !data.endsWith("\n")) fail("incomplete journal entry");
  return data.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
function revisions(dir) {
  const rows = readLines(path.join(dir, JOURNAL), MAX_JOURNAL_BYTES);
  rows.forEach((row, index) => {
    if (row.schema !== "codeblack.aegis-policy-revision.v1" || row.revision !== index + 1 ||
        !["baseline", "draft", "rollback"].includes(row.action)) fail("invalid policy revision journal");
    cutoff(row.evidence_cutoff);
  });
  return rows;
}
function appendRevision(dir, row) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const fd = fs.openSync(path.join(dir, JOURNAL), "a", 0o640);
  try { fs.writeSync(fd, JSON.stringify(row) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return row;
}
function baseRow(revision, action, evidenceCutoff, actor, sourceRevision = null) {
  return { schema: "codeblack.aegis-policy-revision.v1", revision, action,
    evidence_cutoff: cutoff(evidenceCutoff), actor: actorName(actor),
    source_revision: sourceRevision, created_at: new Date().toISOString(),
    activation_state: "draft_only" };
}
function initPolicy(dir, liveConfig, actor = "system") {
  if (revisions(dir).length) fail("policy journal already initialized");
  return appendRevision(dir, baseRow(1, "baseline", config(liveConfig).evidence_cutoff, actor));
}
function createDraft(dir, evidenceCutoff, actor, expectedRevision) {
  const rows = revisions(dir);
  if (!rows.length) fail("policy journal not initialized");
  if (expectedRevision !== rows.at(-1).revision) fail("stale policy revision");
  return appendRevision(dir, baseRow(rows.length + 1, "draft", evidenceCutoff, actor, rows.at(-1).revision));
}
function rollbackDraft(dir, targetRevision, actor, expectedRevision) {
  const rows = revisions(dir);
  if (!rows.length) fail("policy journal not initialized");
  if (expectedRevision !== rows.at(-1).revision) fail("stale policy revision");
  const target = rows.find((row) => row.revision === targetRevision);
  if (!target) fail("unknown target revision");
  return appendRevision(dir, baseRow(rows.length + 1, "rollback", target.evidence_cutoff, actor, targetRevision));
}
function policyStatus(dir, liveConfig) {
  const rows = revisions(dir);
  return { schema: "codeblack.aegis-policy-status.v1", live: {
    evidence_cutoff: config(liveConfig).evidence_cutoff,
    delivery_enabled: liveConfig?.delivery_enabled === true,
  }, current_draft: rows.at(-1) || null, revisions: rows.slice(-20).reverse(),
  activation_locked: true, drafts_affect_live_scanner: false };
}

function validateScenario(value) {
  if (!value || typeof value !== "object" || !WARNING_TYPES.has(value.warning)) fail("invalid warning type");
  if (typeof value.candidateAvailable !== "boolean" || typeof value.deliveryEnabled !== "boolean")
    fail("invalid scenario toggles");
  if (!Number.isInteger(value.evidenceScore) || value.evidenceScore < 0 || value.evidenceScore > 100)
    fail("evidenceScore must be an integer from 0 through 100");
  if (!Number.isFinite(value.scanAgeMinutes) || value.scanAgeMinutes < 0 || value.scanAgeMinutes > 60)
    fail("scanAgeMinutes must be from 0 through 60");
  return { warning: value.warning, candidateAvailable: value.candidateAvailable,
    evidenceScore: value.evidenceScore, evidenceCutoff: cutoff(value.evidenceCutoff),
    scanAgeMinutes: value.scanAgeMinutes, deliveryEnabled: value.deliveryEnabled };
}
function replayScenario(input) {
  const draft = validateScenario(input);
  const trace = [
    { step: "Official NWS warning", outcome: `${draft.warning} · independent Discord alert remains unchanged` },
    { step: "Radar acquisition", outcome: "Nearest WSR-88D and newest completed volume (hypothetical)" },
  ];
  let decision, reason;
  if (!draft.candidateAvailable) {
    decision = "NO_CANDIDATE"; reason = "No persistent, corroborated radar candidate was supplied.";
  } else if (draft.scanAgeMinutes > 15) {
    decision = "STALE"; reason = "Candidate is older than the 15-minute downstream freshness limit.";
  } else if (draft.evidenceScore < draft.evidenceCutoff) {
    decision = "BELOW_CUTOFF";
    reason = `Evidence score ${draft.evidenceScore} is below the draft cutoff ${draft.evidenceCutoff}.`;
  } else if (!draft.deliveryEnabled) {
    decision = "SHADOW"; reason = "Candidate passes the draft cutoff, but delivery is switched off.";
  } else {
    decision = "WOULD_ROUTE"; reason = "This draft would route a supplemental, unconfirmed candidate.";
  }
  trace.push({ step: "Evidence policy", outcome: reason });
  const routed = decision === "WOULD_ROUTE";
  trace.push({ step: "Fabric feed", outcome: routed ? "Would append one idempotent alert event" : "No public alert event" });
  trace.push({ step: "Subscribers", outcome: routed ? "OPS Aegis map + weather-alerts Discord would receive it" : "No Aegis notification" });
  return { schema: "codeblack.aegis-policy-replay.v1", mode: "scenario", dry_run: true,
    no_messages_sent: true, no_config_changed: true, decision, reason,
    fabric: routed, ops: routed, discord: routed, trace };
}
function replayRecorded(dir, liveConfig, options = {}) {
  const evidenceCutoff = cutoff(options.evidenceCutoff);
  const limit = options.limit ?? 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail("limit must be from 1 through 50");
  const records = readLines(path.join(dir, "scans.jsonl"), MAX_SCAN_BYTES).slice(-limit);
  const cfg = config({ ...liveConfig, evidence_cutoff: evidenceCutoff });
  const scans = records.map((record) => {
    const assessedAt = Date.parse(record.processedAt || record.scanTime);
    const candidates = (record.candidates || []).slice(0, 50).map((candidate) => {
      // The capture already associated this candidate with an NWS polygon.
      // Historical geometry is not re-fetched; this is a screening replay,
      // not a fresh spatial verification or a tornado ground-truth label.
      const rating = scoreRecordedEvidence(candidate, record, cfg, assessedAt);
      return { warning_id: candidate.warningId || null, coordinates: candidate.coordinates,
        evidence_score: rating?.score ?? null, factors: rating?.factors ?? [],
        decision: !rating ? "EVIDENCE_GATE_FAILED" : rating.aboveCutoff ? "WOULD_QUALIFY" : "BELOW_CUTOFF" };
    });
    return { site: record.site, volume_key: record.key, scan_time: record.scanTime,
      processed_at: record.processedAt, available_products: record.availableProducts,
      limitations: record.radarLimitations || [], candidates };
  });
  return { schema: "codeblack.aegis-policy-replay.v1", mode: "recorded", dry_run: true,
    no_messages_sent: true, no_config_changed: true, evidence_cutoff: evidenceCutoff,
    scans_reviewed: scans.length, candidates_reviewed: scans.reduce((n, scan) => n + scan.candidates.length, 0),
    scans, limitation: "Replays captured screening candidates only; archived warning polygons and ground truth are not revalidated." };
}

if (require.main === module) {
  const dir = process.env.CODEBLACK_AEGIS_RADAR_DATA || "/srv/codeblack/data/radar-worker/aegis-warning";
  const liveConfig = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
  const [action, value, actor, expected] = process.argv.slice(2);
  try {
    let result;
    if (action === "init") result = initPolicy(dir, liveConfig, value || "system");
    else if (action === "draft") result = createDraft(dir, Number(value), actor, Number(expected));
    else if (action === "rollback") result = rollbackDraft(dir, Number(value), actor, Number(expected));
    else if (action === "status") result = policyStatus(dir, liveConfig);
    else fail("usage: init [actor] | draft <cutoff> <actor> <expected_revision> | rollback <target_revision> <actor> <expected_revision> | status");
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { revisions, initPolicy, createDraft, rollbackDraft, policyStatus,
  replayScenario, replayRecorded };
