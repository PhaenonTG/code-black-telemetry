import type { BridgeStorage } from "./producer-bridge";

type Demand = { jpeg?: number; hls?: number };
const KEY = "producer-preview-demand";
// Called only after outer workstation/user authentication. A failed first
// preview fetch also wakes the uploader, without relaxing media freshness.
export async function requestPreview(storage: BridgeStorage, kind: keyof Demand): Promise<void> {
  const now = Date.now();
  const value = await storage.get<Demand>(KEY) ?? {};
  if ((value[kind] ?? 0) > now + 10_000) return;
  await storage.put(KEY, { ...value, [kind]: now + 20_000 });
}

export async function previewDemand(storage: BridgeStorage): Promise<Demand> {
  const value = await storage.get<Demand>(KEY) ?? {};
  const now = Date.now();
  return {
    jpeg: Math.max(0, Math.min(20_000, (value.jpeg ?? 0) - now)),
    hls: Math.max(0, Math.min(20_000, (value.hls ?? 0) - now)),
  };
}
