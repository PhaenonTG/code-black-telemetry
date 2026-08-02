import { distanceMiles } from "./telemetry/quality";

export interface SpotterContactField {
  label: string;
  value: string;
}

export interface Spotter {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceMiles: number;
  updatedAtText: string;
  status: string;
  contact: SpotterContactField[];
}

type Position = { lat: number; lon: number };

// Public, non-commercial, no-auth GRLevelX overlay feed — the same one GR2Analyst/RadarScope
// plot spotters from. Format is NOT JSON: repeated "Object: lat,lon" / "Icon: ...,\"tooltip\"" /
// "Text: ..." / "End:" blocks. The tooltip is a quoted string with literal "\n" (backslash-n, not
// a real newline) separating: name, timestamp, status, then zero or more optional
// "Label: value" contact lines (Phone/Email/Twitter/Web/Ham/Note/IM — whatever that spotter chose
// to share on their profile). Confirmed against real fetched data 2026-08-02; if Spotter Network
// changes this format, this parser will just find nothing rather than throw.
// spotternetwork.org/feeds.php marks this "NON-COMMERCIAL USE ONLY" — fine for this personal
// vehicle dashboard, but if this app is ever distributed/sold, that needs Spotter Network's
// explicit sign-off first (ryan@spotternetwork.org is their contact for developer integrations).
const SPOTTER_FEED_URL = "https://www.spotternetwork.org/feeds/gr.txt";

function parseSpotterFeed(raw: string, origin: Position): Spotter[] {
  const lines = raw.split("\n");
  const spotters: Spotter[] = [];
  let pending: Position | null = null;
  let index = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("Object:")) {
      const [latStr, lonStr] = line.slice("Object:".length).trim().split(",");
      const lat = Number(latStr);
      const lon = Number(lonStr);
      pending = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
      continue;
    }
    if (line.startsWith("Icon:") && pending) {
      const match = line.match(/"([^"]*)"/);
      const position = pending;
      pending = null;
      if (!match) continue;
      const parts = match[1].split("\\n").map((part) => part.trim()).filter(Boolean);
      const [name, timestamp, status, ...rest] = parts;
      if (!name) continue;
      const contact: SpotterContactField[] = [];
      for (const entry of rest) {
        const separator = entry.indexOf(":");
        if (separator === -1) continue;
        const label = entry.slice(0, separator).trim();
        const value = entry.slice(separator + 1).trim();
        if (label && value) contact.push({ label, value });
      }
      spotters.push({
        id: `${position.lat.toFixed(4)},${position.lon.toFixed(4)}-${index++}`,
        name,
        lat: position.lat,
        lon: position.lon,
        distanceMiles: distanceMiles(origin, position),
        updatedAtText: timestamp ?? "",
        status: status ?? "",
        contact,
      });
    }
  }

  return spotters;
}

export async function getNearbySpotters(origin: Position): Promise<{ spotters: Spotter[]; error: string }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(SPOTTER_FEED_URL, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = await response.text();
    const spotters = parseSpotterFeed(text, origin).sort((a, b) => a.distanceMiles - b.distanceMiles);
    return { spotters, error: "" };
  } catch (error) {
    return { spotters: [], error: error instanceof Error ? error.message : "Spotter feed fetch failed" };
  } finally {
    window.clearTimeout(timer);
  }
}

