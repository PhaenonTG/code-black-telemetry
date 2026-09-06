import type { FabricNormalizedState } from "../../../../src/services/fabric";

export function fabricStateFromSnapshot(payload: unknown): FabricNormalizedState | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Partial<FabricNormalizedState>;
  if (record.schema !== "codeblack.fabric.unit-state" || !Array.isArray(record.units)) return null;
  return record as FabricNormalizedState;
}
