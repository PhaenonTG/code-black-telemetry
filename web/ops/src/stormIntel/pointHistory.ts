import type { MetricSource, StormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/types";
import type { StormIntelHistoryEntry } from "../core/types";
import { firstAvailableSource, stormIntelSummary } from "./format";

const DEDUP_DISTANCE_DEG = 0.015;

export const POINT_HISTORY_LIMIT = 12;

function entryId(point: { lat: number; lon: number }, selectedAt: number): string {
  return `${point.lat.toFixed(4)},${point.lon.toFixed(4)}:${selectedAt}`;
}

function closeEnough(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) <= DEDUP_DISTANCE_DEG && Math.abs(a.lon - b.lon) <= DEDUP_DISTANCE_DEG;
}

function resolvedPoint(source: MetricSource | null): StormIntelHistoryEntry["resolved"] {
  if (source?.resolvedLatitude == null || source.resolvedLongitude == null) return null;
  return { lat: source.resolvedLatitude, lon: source.resolvedLongitude };
}

export function historyEntryFromSnapshot(
  requested: { lat: number; lon: number },
  snapshot: StormIntelSnapshot,
  selectedAt = Date.now(),
): StormIntelHistoryEntry {
  const source = firstAvailableSource(snapshot);
  return {
    id: entryId(requested, selectedAt),
    requested,
    resolved: resolvedPoint(source),
    gridDistanceKm: source?.gridDistanceKm ?? null,
    provider: source?.provider ?? snapshot.providerName,
    product: source?.product ?? null,
    runTime: source?.runTime ?? null,
    validTime: source?.validTime ?? null,
    forecastHour: source?.forecastHour ?? null,
    dataClass: source?.dataClass ?? snapshot.metrics.find((metric) => metric.dataClass)?.dataClass ?? null,
    selectedAt,
    summary: stormIntelSummary(snapshot),
  };
}

export function addPointHistoryEntry(
  history: StormIntelHistoryEntry[],
  entry: StormIntelHistoryEntry,
  limit = POINT_HISTORY_LIMIT,
): StormIntelHistoryEntry[] {
  const withoutNearDuplicate = history.filter((existing) => !closeEnough(existing.requested, entry.requested));
  return [entry, ...withoutNearDuplicate].slice(0, limit);
}
