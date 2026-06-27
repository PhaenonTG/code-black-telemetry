import { create } from "zustand";
import provider from "../services/telemetry";
import type { TelemetrySnapshot } from "../services/telemetry";

interface TelemetryStore {
  snapshot: TelemetrySnapshot | null;
  setSnapshot: (s: TelemetrySnapshot) => void;
}

const useStore = create<TelemetryStore>(set => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

// Subscribe once at module level — prevents re-subscribing on every render
provider.subscribe(snapshot => useStore.getState().setSnapshot(snapshot));

export function useTelemetry() {
  return useStore(s => s.snapshot);
}

// For components that only need one slice
export function useWind()    { return useStore(s => s.snapshot?.wind); }
export function useWeather() { return useStore(s => s.snapshot?.weather); }
export function useGps()     { return useStore(s => s.snapshot?.gps); }
export function usePower()   { return useStore(s => s.snapshot?.power); }
export function useSystem()  { return useStore(s => s.snapshot?.system); }
export function useStatus()  { return useStore(s => s.snapshot?.status); }
export function useSensors() { return useStore(s => s.snapshot?.sensors); }
export function useEvents()  { return useStore(s => s.snapshot?.events); }
