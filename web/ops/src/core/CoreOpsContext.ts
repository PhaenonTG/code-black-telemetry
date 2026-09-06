import { createContext } from "react";
import type { OpsCoreConfig } from "./config";
import type { OpsCoreState } from "./types";

export type OpsSelectedPoint = { lat: number; lon: number };

export interface CoreOpsContextValue {
  config: OpsCoreConfig;
  state: OpsCoreState;
  selectedPoint: OpsSelectedPoint | null;
  selectPoint(point: OpsSelectedPoint | null): void;
}

export const CoreOpsContext = createContext<CoreOpsContextValue | null>(null);
