import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
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

// The provider replaces the whole snapshot object every poll tick (2s on a real Pi, 1s in the
// simulator) even when most of a given tick's values are identical to last time -- e.g. wind and
// power don't change every 2 seconds just because GPS does. Every one of these slice selectors used
// to return a fresh object reference on every tick regardless, so every subscribed component
// (across all pages, since the swipeable pager keeps them all mounted at once) re-rendered on every
// tick even when its own slice's fields were unchanged. useShallow compares each slice's own fields
// with Object.is and bails the re-render when nothing in it actually moved -- every field on
// WindData/WeatherData/GpsData/PowerData/SystemData/StatusData is a flat primitive, so a shallow
// compare is exactly correct here (not just an approximation).
export function useTelemetry() {
  return useStore(s => s.snapshot);
}

// For components that only need one slice
export function useWind()    { return useStore(useShallow(s => s.snapshot?.wind)); }
export function useWeather() { return useStore(useShallow(s => s.snapshot?.weather)); }
export function useGps()     { return useStore(useShallow(s => s.snapshot?.gps)); }
export function usePower()   { return useStore(useShallow(s => s.snapshot?.power)); }
export function useSystem()  { return useStore(useShallow(s => s.snapshot?.system)); }
export function useStatus()  { return useStore(useShallow(s => s.snapshot?.status)); }
export function useSensors() { return useStore(useShallow(s => s.snapshot?.sensors)); }
export function useEvents()  { return useStore(useShallow(s => s.snapshot?.events)); }
