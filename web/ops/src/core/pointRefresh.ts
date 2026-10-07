import type { OpsSelectedPoint } from "./CoreOpsContext";
import type { StormIntelState } from "./types";

export function shouldRefreshPoint(previous: OpsSelectedPoint | null, next: OpsSelectedPoint, elapsedMs: number): boolean {
  if (!previous) return true;
  if (elapsedMs >= 300_000) return true;
  if (elapsedMs < 60_000) return false;
  const radians = Math.PI / 180;
  const a = Math.sin((next.lat - previous.lat) * radians / 2) ** 2
    + Math.cos(previous.lat * radians) * Math.cos(next.lat * radians) * Math.sin((next.lon - previous.lon) * radians / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) >= 1;
}

export function mergeStormHealth(current: StormIntelState, health: Pick<StormIntelState, "state" | "detail" | "checkedAt" | "health">): StormIntelState {
  return {
    ...current,
    ...(!current.selectedPoint ? health : {}),
    health: health.health,
    serviceState: health.state,
    serviceDetail: health.detail,
  };
}
