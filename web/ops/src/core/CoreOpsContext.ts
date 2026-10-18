import { createContext } from "react";
import type { OpsCoreConfig } from "./config";
import type { OpsCoreState, StormIntelHistoryEntry } from "./types";
import type { LocationState } from "../adapters/LocationAdapter";
import type { LiveChaserFix, LocationMode } from "./referenceLocation";

export type OpsSelectedPoint = { lat: number; lon: number };

export interface CoreOpsContextValue {
  config: OpsCoreConfig;
  state: OpsCoreState;
  selectedPoint: OpsSelectedPoint | null;
  pointHistory: StormIntelHistoryEntry[];
  locationMode: LocationMode;
  deviceLocation: LocationState;
  referenceUnitId: string;
  referenceLabel: string;
  referenceIsFallback: boolean;
  referenceIsStale: boolean;
  referenceChaserFix: LiveChaserFix | null;
  chooseChaserLocation(unitId: string): void;
  chooseFallbackLocation(): void;
  updateDeviceLocation(point: OpsSelectedPoint): void;
  followDeviceLocation(): void;
  refreshPoint(): void;
  selectPoint(point: OpsSelectedPoint | null): void;
  selectHistoryPoint(entry: StormIntelHistoryEntry): void;
}

export const CoreOpsContext = createContext<CoreOpsContextValue | null>(null);
