// Offline, read-only evaluation of human-reviewed scan/warning labels.
// A warning alone is NOT a tornado label; this module never enables delivery.
const fs = require("node:fs");
const { config, scoreRecordedEvidence } = require("./aegis-warning.cjs");

const MAX_BYTES = 32 * 1024 * 1024;
const CUTOFFS = [70, 75, 80, 85, 90, 95, 100];
const TRUTHS = new Set(["confirmed_tornado", "reviewed_no_tornado", "uncertain"]);

function readJsonLines(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw new Error("evaluation input exceeds 32 MiB");
  const text = fs.readFileSync(file, "utf8");
  if (text && !text.endsWith("\n")) throw new Error("incomplete JSONL input");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function evaluate(scans, labels, liveConfig) {
  if (!Array.isArray(scans) || !Array.isArray(labels)) throw new Error("scans and labels must be arrays");
  const byScan = new Map();
  for (const scan of scans) {
    if (!scan || typeof scan.site !== "string" || typeof scan.key !== "string") throw new Error("invalid scan identity");
    const identity = `${scan.site}\0${scan.key}`;
    if (byScan.has(identity)) throw new Error("duplicate scan identity");
    byScan.set(identity, scan);
  }
  const seen = new Set();
  const rows = [];
  for (const label of labels) {
    if (!label || typeof label.site !== "string" || typeof label.volume_key !== "string" ||
        typeof label.warning_id !== "string" || !TRUTHS.has(label.truth) ||
        typeof label.reviewer !== "string" || !label.reviewer.trim() ||
        typeof label.source_url !== "string" || !/^https:\/\//.test(label.source_url) ||
        typeof label.reviewed_at !== "string" || !Number.isFinite(Date.parse(label.reviewed_at)))
      throw new Error("invalid label; independent reviewer, evidence URL, and timestamp are required");
    const identity = `${label.site}\0${label.volume_key}`;
    const key = `${identity}\0${label.warning_id}`;
    if (seen.has(key)) throw new Error("duplicate label identity");
    seen.add(key);
    const scan = byScan.get(identity);
    if (!scan) throw new Error("label references a scan absent from the supplied archive");
    if (Array.isArray(scan.warningContext) && !scan.warningContext.some((warning) => warning.id === label.warning_id))
      throw new Error("label warning was not presented to this scan");
    if (label.truth === "uncertain") continue;
    const assessedAt = Date.parse(scan.processedAt || scan.scanTime);
    const ratings = (scan.candidates || [])
      .filter((candidate) => candidate.warningId === label.warning_id)
      .map((candidate) => scoreRecordedEvidence(candidate, scan, config(liveConfig), assessedAt))
      .filter(Boolean);
    rows.push({ truth: label.truth, max_score: ratings.length ? Math.max(...ratings.map((rating) => rating.score)) : null });
  }
  const metrics = CUTOFFS.map((cutoff) => {
    const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
    for (const row of rows) {
      const predicted = row.max_score !== null && row.max_score >= cutoff;
      const positive = row.truth === "confirmed_tornado";
      counts[predicted ? (positive ? "tp" : "fp") : (positive ? "fn" : "tn")]++;
    }
    const precisionDenominator = counts.tp + counts.fp;
    const recallDenominator = counts.tp + counts.fn;
    return { cutoff, ...counts,
      precision: precisionDenominator ? counts.tp / precisionDenominator : null,
      recall: recallDenominator ? counts.tp / recallDenominator : null };
  });
  return { schema: "codeblack.aegis.calibration-review.v1", dry_run: true,
    delivery_unchanged: true, evaluable: rows.length > 0, labeled_examples: rows.length,
    uncertain_excluded: labels.length - rows.length, metrics,
    limitation: "Labels require independent human review; this report is not probability calibration or authority to activate alerts." };
}

if (require.main === module) {
  const [scansFile, labelsFile, configFile] = process.argv.slice(2);
  if (!scansFile || !labelsFile || !configFile) {
    console.error("usage: node aegis-calibration.cjs <scans.jsonl> <reviewed-labels.jsonl> <config.json>");
    process.exitCode = 2;
  } else {
    try {
      const report = evaluate(readJsonLines(scansFile), readJsonLines(labelsFile),
        JSON.parse(fs.readFileSync(configFile, "utf8")));
      console.log(JSON.stringify(report, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}

module.exports = { evaluate, readJsonLines };
