import type { NormalizedMetric, StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";

export const PRIMARY_STORM_METRICS: NormalizedMetric["key"][] = [
  "mlcape",
  "mlcin",
  "mucape",
  "srh_0_1km",
  "srh_0_3km",
  "bulk_shear_0_6km",
  "lcl_height",
  "lapse_rate_0_3km",
  "lapse_rate_700_500mb",
  "surface_temperature",
  "surface_dewpoint",
  "relative_humidity",
  "significant_tornado_parameter",
];

export function metricByKey(snapshot: StormIntelSnapshot | null, key: NormalizedMetric["key"]): NormalizedMetric | null {
  return snapshot?.metrics.find((metric) => metric.key === key) ?? null;
}

export function formatMetric(metric: NormalizedMetric | null): string {
  if (!metric || metric.availability !== "available" || metric.value === null) return "UNAVAILABLE";
  const unit = metric.unit ? ` ${metric.unit}` : "";
  return `${Number.isInteger(metric.value) ? metric.value.toFixed(0) : metric.value.toFixed(1)}${unit}`;
}

export function metricProvenance(metric: NormalizedMetric | null): string {
  if (!metric?.source) return metric?.unavailableReason ?? "No source";
  const run = metric.source.runTime ? new Date(metric.source.runTime).toISOString().slice(11, 16) + "Z" : "run unknown";
  const valid = metric.source.validTime ? new Date(metric.source.validTime).toISOString().slice(11, 16) + "Z" : "valid unknown";
  return `${metric.dataClass ?? "UNKNOWN"} · ${metric.source.provider} ${metric.source.product} · ${run} / ${valid}`;
}

export function stormIntelSummary(snapshot: StormIntelSnapshot | null): string {
  if (!snapshot) return "Select a point or connect Core for Storm Intel.";
  if (!snapshot.available) return snapshot.unavailableReason ?? "Storm Intel unavailable.";
  const score = snapshot.score.available && snapshot.score.value !== null ? `${Math.round(snapshot.score.value)}` : "NO SCORE";
  return `${snapshot.providerName} · ${score} · ${snapshot.context.contextType}`;
}
