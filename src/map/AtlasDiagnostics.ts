import type { AtlasDiagnosticsSnapshot, AtlasLifecycleCounters } from "./types";

const KEY = "codeblack.atlas.diagnostics";
let instanceCount = 0;
const counters: AtlasLifecycleCounters = {
  reactMounts: 0,
  reactUnmounts: 0,
  mapConstructors: 0,
  mapRemoves: 0,
  styleLoads: 0,
  sourceCreations: 0,
  layerCreations: 0,
  sourceUpdates: 0,
  radarImageUpdates: 0,
};

export function incrementAtlasMapInstances() {
  instanceCount += 1;
  return instanceCount;
}

export function decrementAtlasMapInstances() {
  instanceCount = Math.max(0, instanceCount - 1);
  return instanceCount;
}

export function atlasMapInstanceCount() {
  return instanceCount;
}

export function incrementAtlasCounter(name: keyof AtlasLifecycleCounters, amount = 1) {
  counters[name] += amount;
  return counters[name];
}

export function atlasLifecycleCounters() {
  return { ...counters };
}

export function writeAtlasDiagnostics(snapshot: AtlasDiagnosticsSnapshot) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Diagnostics must never affect map rendering.
  }
}

export function readAtlasDiagnostics(): AtlasDiagnosticsSnapshot | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as AtlasDiagnosticsSnapshot : null;
  } catch {
    return null;
  }
}
