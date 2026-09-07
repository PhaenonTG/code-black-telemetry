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

const CELSIUS_UNIT_PATTERN = /^(deg\s?c|°\s?c|c|celsius)$/i;

function isCelsiusUnit(unit: string | null): boolean {
  return unit != null && CELSIUS_UNIT_PATTERN.test(unit.trim());
}

// Core ships raw model-native units (degC for every temperature field observed so far) -- chasers
// in the US read temperature in Fahrenheit, so this is a display-layer conversion only. Threat
// banding below reuses this on the raw value too, so a dewpoint threshold reads correctly
// regardless of which unit Core happens to report.
function toFahrenheitValue(value: number, unit: string | null): number {
  return isCelsiusUnit(unit) ? (value * 9) / 5 + 32 : value;
}

export function formatMetric(metric: NormalizedMetric | null): string {
  if (!metric || metric.availability !== "available" || metric.value === null) return "UNAVAILABLE";
  const celsius = isCelsiusUnit(metric.unit);
  const value = celsius ? toFahrenheitValue(metric.value, metric.unit) : metric.value;
  const unitLabel = celsius ? "degF" : metric.unit;
  const unit = unitLabel ? ` ${unitLabel}` : "";
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}${unit}`;
}

export type MetricThreatLevel = "low" | "moderate" | "high" | "neutral";

// How favorable the reading is for tornado development, banded on standard SPC-style mesoanalysis
// conventions (SPC Mesoanalysis parameter pages, Rasmussen & Blanchard 1998 for LCL/STP) -- "high"
// is most favorable, "low" is least. Metrics with no established single-point severe-weather
// threshold (raw temperature, humidity) stay "neutral" rather than asserting a threat level that
// isn't real; a single value out of vertical-profile context can't honestly say more than that.
function bandLowToHigh(value: number, moderateAt: number, highAt: number): MetricThreatLevel {
  if (value >= highAt) return "high";
  if (value >= moderateAt) return "moderate";
  return "low";
}

function bandHighToLow(value: number, moderateAt: number, highAt: number): MetricThreatLevel {
  if (value <= highAt) return "high";
  if (value <= moderateAt) return "moderate";
  return "low";
}

export function metricThreatLevel(metric: NormalizedMetric | null): MetricThreatLevel {
  if (!metric || metric.availability !== "available" || metric.value === null) return "neutral";
  const v = metric.value;
  switch (metric.key) {
    case "sbcape":
    case "mlcape":
    case "mucape":
      return bandLowToHigh(v, 1000, 2500);
    case "sbcin":
    case "mlcin":
    case "mucin":
      // CIN is <= 0 -- closer to 0 (a weaker cap) is more favorable for storm initiation.
      return bandLowToHigh(v, -100, -25);
    case "srh_0_1km":
      return bandLowToHigh(v, 100, 250);
    case "srh_0_3km":
      return bandLowToHigh(v, 150, 300);
    case "bulk_shear_0_6km":
      return bandLowToHigh(v, 15, 20);
    case "lcl_height":
      // Lower LCL height is more favorable for tornadoes.
      return bandHighToLow(v, 1500, 1000);
    case "lapse_rate_0_3km":
      return bandLowToHigh(v, 6.5, 8);
    case "lapse_rate_700_500mb":
      return bandLowToHigh(v, 6.5, 7);
    case "surface_dewpoint":
      return bandLowToHigh(toFahrenheitValue(v, metric.unit), 50, 60);
    case "significant_tornado_parameter":
      return bandLowToHigh(v, 1, 3);
    case "supercell_composite_parameter":
      return bandLowToHigh(v, 1, 4);
    default:
      return "neutral";
  }
}

export function metricProvenance(metric: NormalizedMetric | null): string {
  if (!metric?.source) return metric?.unavailableReason ?? "No source";
  const run = metric.source.runTime ? new Date(metric.source.runTime).toISOString().slice(11, 16) + "Z" : "run unknown";
  const valid = metric.source.validTime ? new Date(metric.source.validTime).toISOString().slice(11, 16) + "Z" : "valid unknown";
  const fh = metric.source.forecastHour === null ? "FH ?" : `FH ${metric.source.forecastHour}`;
  return `${metric.dataClass ?? "UNKNOWN"} · ${metric.source.provider} ${metric.source.product} · ${run} / ${valid} · ${fh}`;
}

export function stormIntelSummary(snapshot: StormIntelSnapshot | null): string {
  if (!snapshot) return "Select a point or connect Core for Storm Intel.";
  if (!snapshot.available) return snapshot.unavailableReason ?? "Storm Intel unavailable.";
  const score = snapshot.score.available && snapshot.score.value !== null ? `${Math.round(snapshot.score.value)}` : "NO SCORE";
  return `${snapshot.providerName} · ${score} · ${snapshot.context.contextType}`;
}

export function sourceSemantics(metric: NormalizedMetric | null): "DIRECT" | "CALCULATED" | "PROXY" | "UNAVAILABLE" {
  if (!metric || metric.availability !== "available") return "UNAVAILABLE";
  const text = `${metric.derivation ?? ""} ${metric.source?.formulation ?? ""}`.toLowerCase();
  if (text.includes("proxy")) return "PROXY";
  if (text.includes("calculat") || text.includes("derived")) return "CALCULATED";
  return "DIRECT";
}

export function firstAvailableSource(snapshot: StormIntelSnapshot | null) {
  return snapshot?.metrics.find((metric) => metric.source)?.source ?? null;
}
