import { fetchStormIntelPoint } from "./client"
import { useEffect, useState } from "react"
import { useCoreOps } from "./useCoreOps"
import type { OpsCoreState } from "./types"

type Status = Pick<OpsCoreState, "core" | "fabric">
// In-memory only: retained across route/provider remounts, never persisted to disk.
let retained: Status | null = null
export function retainedOpsStatus(): Status | null { return retained }
export function rememberOpsStatus(state: Status): void { retained = statusView(state, retained, Date.now()) }

export function statusView(current: Status, previous: Status | null, now: number): Status {
  const core = current.core.state !== "LIVE" && previous?.core.state !== "CHECKING" && previous ? previous.core : current.core
  const fabric = !current.fabric.units && previous?.fabric.units ? previous.fabric : current.fabric
  const coreOld = core !== current.core || core.state === "STALE" || now - core.checkedAt > 60_000
  const fabricAt = fabric.unitsReceivedAt ?? fabric.lastContactAt ?? fabric.checkedAt
  const fabricOld = fabric !== current.fabric || now - fabricAt > 60_000 || (fabric.units !== null && fabric.streamState !== "open")
  return {
    core: coreOld ? { ...core, state: "STALE" } : core,
    fabric: fabricOld ? { ...fabric, state: "STALE" } : fabric,
  }
}

export function statusAge(at: number | null | undefined, now: number): string {
  return at == null ? "age unavailable" : `${Math.max(0, Math.floor((now - at) / 1000))}s ago`
}

export function useSharedOpsStatus() {
  const { state } = useCoreOps()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return { ...statusView(state, retained, now), now }
}

export function createPointLookup() {
  const reads = new Map<string, { at: number; promise: ReturnType<typeof fetchStormIntelPoint> }>();
  return (config: Parameters<typeof fetchStormIntelPoint>[0], point: { lat: number; lon: number }, revision = 0) => {
    const key = `${config.coreBaseUrl}:${point.lat}:${point.lon}:${revision}`;
    const previous = reads.get(key);
    if (previous && Date.now() - previous.at < 30_000) return previous.promise;
    const promise = fetchStormIntelPoint(config, point);
    const entry = { at: Date.now(), promise };
    reads.set(key, entry);
    // A rejected read must remain retryable, including after a navigation.
    void promise.catch(() => { if (reads.get(key) === entry) reads.delete(key); });
    for (const [storedKey, read] of reads) if (Date.now() - read.at > 30_000) reads.delete(storedKey);
    return promise;
  };
}
export const lookupPoint = createPointLookup();

