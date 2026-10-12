import type { FabricNormalizedState } from "../../../../src/services/fabric";

function timestamp(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function fabricStateFromSnapshot(payload: unknown): FabricNormalizedState | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Partial<FabricNormalizedState>;
  if (record.schema !== "codeblack.fabric.unit-state" || !Array.isArray(record.units)) return null;
  const generatedAt = timestamp(record.generated_at);
  if (generatedAt === null || record.units.some((unit) => !unit || typeof unit.unit_id !== "string" || !Array.isArray(unit.devices))) return null;
  // Core's JSON wire timestamps are ISO strings; the shared/native UI contract uses epoch ms.
  // Normalize both REST and socket snapshots once. Missing/invalid clocks remain unknown.
  return {
    ...record as FabricNormalizedState,
    generated_at: generatedAt,
    units: record.units.map((unit) => ({
      ...unit,
      last_seen: timestamp(unit.last_seen),
      devices: unit.devices.filter((device) => device && typeof device.device_id === "string").map((device) => ({ ...device, last_seen: timestamp(device.last_seen) })),
    })),
  };
}
