import type { NormalizedMetric } from "../stormIntel/types";

export function formatMetricValue(metric: NormalizedMetric): string {
  if (metric.value === null) return "--";
  const rounded = Math.abs(metric.value) >= 100 ? Math.round(metric.value) : Math.round(metric.value * 10) / 10;
  const sign = metric.key.endsWith("cin") && rounded > 0 ? "-" : "";
  return `${sign}${rounded}`;
}

export function formatAge(ageSeconds: number | null): string {
  if (ageSeconds === null) return "--";
  if (ageSeconds < 60) return `${ageSeconds}s`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export function formatTrend(metric: NormalizedMetric): string | null {
  if (!metric.trend || metric.trend.delta === null) return null;
  const arrow = metric.trend.direction === "rising" ? "↑" : metric.trend.direction === "falling" ? "↓" : "→";
  const magnitude = Math.abs(Math.round(metric.trend.delta));
  return `${arrow}${magnitude > 0 ? magnitude : ""}`;
}

export function formatScore(value: number | null): string {
  if (value === null) return "--";
  return value.toFixed(1);
}

const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function formatHeading(headingDeg: number | null): string {
  if (headingDeg === null || !Number.isFinite(headingDeg)) return "--";
  const normalized = ((headingDeg % 360) + 360) % 360;
  const index = Math.round(normalized / 22.5) % 16;
  return COMPASS_POINTS[index];
}
