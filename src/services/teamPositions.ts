import type { Spotter } from "./spotters";
import type { TeamMember } from "./settings";

export interface TeamPosition {
  id: string;
  name: string;
  lat: number;
  lon: number;
  updatedAtText: string;
  group: string;
  phone: string;
  email: string;
}

// Interim data source: filters the already-fetched Spotter Network feed against a user-managed
// team roster (settings.ts's teamMembers) by name/marker-ID match. There's no dedicated
// team-position infrastructure yet (the vehicle's own Pi/ESP32 GPS could eventually report
// positions directly, e.g. over Tailscale) -- when that exists, this is the one place that
// changes: swap this function's implementation, or merge a second source in here. The map layer
// and its styling don't change either way.
export function resolveTeamPositions(spotters: Spotter[], members: TeamMember[]): TeamPosition[] {
  if (members.length === 0) return [];
  const byNormalizedName = new Map(members.map((member) => [member.name.trim().toLowerCase(), member]));
  return spotters
    .map((spotter) => {
      const normalized = spotter.name.trim().toLowerCase();
      const match = byNormalizedName.get(normalized) ?? byNormalizedName.get(spotter.id.trim().toLowerCase());
      return match ? { spotter, match } : null;
    })
    .filter((entry): entry is { spotter: Spotter; match: TeamMember } => entry !== null)
    .map(({ spotter, match }) => ({
      id: spotter.id,
      name: spotter.name,
      lat: spotter.lat,
      lon: spotter.lon,
      updatedAtText: spotter.updatedAtText,
      group: match.group,
      phone: match.phone,
      email: match.email,
    }));
}
