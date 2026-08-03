import type { Spotter } from "./spotters";

export interface TeamPosition {
  id: string;
  name: string;
  lat: number;
  lon: number;
  updatedAtText: string;
}

// Interim data source: filters the already-fetched Spotter Network feed against a user-managed
// roster (settings.ts's teamRoster) of names/marker IDs. There's no dedicated team-position
// infrastructure yet (the vehicle's own Pi/ESP32 GPS could eventually report positions directly,
// e.g. over Tailscale) -- when that exists, this is the one place that changes: swap this
// function's implementation, or merge a second source in here. The map layer and its styling don't
// change either way.
export function resolveTeamPositions(spotters: Spotter[], roster: string[]): TeamPosition[] {
  if (roster.length === 0) return [];
  const normalizedRoster = new Set(roster.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  return spotters
    .filter((spotter) => normalizedRoster.has(spotter.name.trim().toLowerCase()) || normalizedRoster.has(spotter.id.trim().toLowerCase()))
    .map((spotter) => ({ id: spotter.id, name: spotter.name, lat: spotter.lat, lon: spotter.lon, updatedAtText: spotter.updatedAtText }));
}
