import { createContext } from "react";
import type { OpsCoreConfig } from "./config";
import type { OpsCoreState, StormIntelHistoryEntry } from "./types";

export type OpsSelectedPoint = { lat: number; lon: number };

export interface CoreOpsContextValue {
  config: OpsCoreConfig;
  state: OpsCoreState;
  selectedPoint: OpsSelectedPoint | null;
  pointHistory: StormIntelHistoryEntry[];
  selectPoint(point: OpsSelectedPoint | null): void;
  selectHistoryPoint(entry: StormIntelHistoryEntry): void;
}

export const CoreOpsContext = createContext<CoreOpsContextValue | null>(null);
