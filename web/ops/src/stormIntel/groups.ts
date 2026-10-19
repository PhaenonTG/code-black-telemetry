import type { MetricKey, NormalizedMetric, StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";
import { metricByKey } from "./format";

export interface StormMetricGroup {
  id: string;
  title: string;
  purpose: string;
  keys: MetricKey[];
}

export const STORM_METRIC_GROUPS: StormMetricGroup[] = [
  {
    id: "instability",
    title: "INSTABILITY",
    purpose: "Buoyancy and inhibition",
    keys: ["sbcape", "sbcin", "mlcape", "mlcin", "mucape", "mucin"],
  },
  {
    id: "low-level",
    title: "LOW-LEVEL / TORNADO ENVIRONMENT",
    purpose: "Near-ground rotation support",
    keys: ["lcl_height", "srh_0_1km", "srh_0_3km"],
  },
  {
    id: "shear",
    title: "SHEAR / STORM MOTION",
    purpose: "Organization and storm-relative flow",
    keys: ["bulk_shear_0_6km"],
  },
  {
    id: "thermo",
    title: "THERMODYNAMICS",
    purpose: "Moisture and thermal profile",
    keys: [
      "surface_temperature",
      "surface_dewpoint",
      "relative_humidity",
      "lapse_rate_0_3km",
      "lapse_rate_700_500mb",
    ],
  },
  {
    id: "supported-index",
    title: "SUPPORTED INDEX",
    purpose: "Only when supplied by Core",
    keys: ["significant_tornado_parameter"],
  },
];

export function metricsForGroup(snapshot: StormIntelSnapshot | null, group: StormMetricGroup): NormalizedMetric[] {
  return group.keys
    .map((key) => metricByKey(snapshot, key))
    .filter((metric): metric is NormalizedMetric => metric !== null);
}

export function availableMetricKeys(snapshot: StormIntelSnapshot | null): MetricKey[] {
  return snapshot?.metrics.map((metric) => metric.key) ?? [];
}
