import { distanceMiles } from "./telemetry/quality";

export type NearbyCategory = "gas" | "hospital" | "lodging" | "food";

export interface NearbyPlace {
  id: string;
  category: NearbyCategory;
  name: string;
  distanceMiles: number;
  lat: number;
  lon: number;
  address: string;
  phone: string;
  hoursStatus: "open" | "closed" | "unknown" | "typical-open";
  hoursText: string;
  beds: number | null;
}

type Position = { lat: number; lon: number };

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SEARCH_RADIUS_METERS = 40_000; // ~25 miles

// Hospital: restrict to amenity=hospital nodes explicitly tagged emergency=yes. A plain "hospital"
// match can be misleading in the field -- confirmed live against Overpass near a test location:
// a rehab hospital and a couple of others are tagged emergency=no, meaning no ER, while most
// full-service hospitals nearby (11 of 14 checked) do carry emergency=yes. Untagged/unconfirmed
// hospitals are deliberately excluded rather than guessed at -- the point of this filter is to
// stop showing a non-ER facility as "the hospital" during what might be a real emergency.
const CATEGORY_QUERIES: Record<NearbyCategory, string[]> = {
  gas: ['node["amenity"="fuel"]'],
  hospital: ['node["amenity"="hospital"]["emergency"="yes"]'],
  lodging: ['node["tourism"="hotel"]', 'node["tourism"="motel"]'],
  food: ['node["amenity"="fast_food"]', 'node["amenity"="restaurant"]'],
};

interface OverpassNode {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

function buildQuery(pos: Position): string {
  const around = `(around:${SEARCH_RADIUS_METERS},${pos.lat.toFixed(5)},${pos.lon.toFixed(5)})`;
  const clauses = (Object.values(CATEGORY_QUERIES).flat()).map((prefix) => `${prefix}${around};`).join("\n  ");
  return `[out:json][timeout:20];\n(\n  ${clauses}\n);\nout body;`;
}

function formatAddress(tags: Record<string, string>): string {
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"],
  ].filter(Boolean);
  return parts.join(", ");
}

// OSM opening_hours is a rich free-text grammar (seasonal rules, holiday exceptions, comments).
// Rather than partially interpret it and risk a confident-but-wrong OPEN/CLOSED claim, this only
// resolves the common case (semicolon-separated day-range + single time-range clauses, or 24/7).
// Anything else falls back to displaying the raw tag text so the human makes the final call.
const DAY_CODES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function expandDayRange(token: string): number[] | null {
  const match = token.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
  if (!match) return null;
  const start = DAY_CODES.indexOf(match[1]);
  const end = match[2] ? DAY_CODES.indexOf(match[2]) : start;
  if (start < 0 || end < 0) return null;
  const days: number[] = [];
  let day = start;
  while (true) {
    days.push(day);
    if (day === end) break;
    day = (day + 1) % 7;
    if (days.length > 7) return null;
  }
  return days;
}

function resolveOpeningHours(raw: string | undefined, now: Date): { status: "open" | "closed" | "unknown"; text: string } {
  if (!raw) return { status: "unknown", text: "Hours unknown" };
  const trimmed = raw.trim();
  if (trimmed === "24/7") return { status: "open", text: "Open 24 hours" };

  const clauses = trimmed.split(";").map((clause) => clause.trim()).filter(Boolean);
  const currentDay = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  let matchedTodayClause = false;
  let openNow = false;

  for (const clause of clauses) {
    const match = clause.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) return { status: "unknown", text: raw };
    const dayTokens = match[1].split(",");
    const days = dayTokens.flatMap((token) => expandDayRange(token) ?? []);
    if (days.length === 0) return { status: "unknown", text: raw };
    if (!days.includes(currentDay)) continue;
    matchedTodayClause = true;
    const startMinutes = Number(match[2]) * 60 + Number(match[3]);
    const endMinutes = Number(match[4]) * 60 + Number(match[5]);
    if (currentMinutes >= startMinutes && currentMinutes < endMinutes) openNow = true;
  }

  if (!matchedTodayClause) return { status: "closed", text: raw };
  return { status: openNow ? "open" : "closed", text: raw };
}

// OSM's opening_hours tag is frequently just missing for real, well-known businesses — confirmed
// live against Overpass for a tagged "Walmart" fuel station near a test location: brand and name
// present, opening_hours absent entirely. Rather than a paid places API (Google/Foursquare), which
// this project has deliberately steered away from, fill two narrow, defensible gaps for free:
// hospitals (the ER is categorically always accessible, this isn't a guess) and a short list of
// national chains that are near-universally 24 hours. Everything else still falls back to
// "unknown" rather than a confident wrong guess — this is explicitly labeled "typical" in the UI,
// distinct from a real OSM-confirmed "open", so the source of the claim stays honest.
const TWENTY_FOUR_HOUR_BRANDS = [
  "walmart", "wal-mart", "quiktrip", "qt", "kum & go", "kum and go", "casey's", "caseys",
  "love's", "loves travel stop", "pilot", "flying j", "racetrac", "circle k", "7-eleven",
  "speedway", "sheetz", "wawa", "buc-ee's", "buc-ees",
];

function inferTypicalHours(category: NearbyCategory, tags: Record<string, string>): { status: "typical-open"; text: string } | null {
  // Only OSM-confirmed emergency=yes facilities reach this point (see CATEGORY_QUERIES) -- EDs
  // are near-universally 24/7, but "typically" stays honest against rare diversion/closure.
  if (category === "hospital") return { status: "typical-open", text: "Emergency dept. — typically open 24 hours" };
  if (category === "gas") {
    const brand = (tags.brand || tags.name || "").toLowerCase();
    if (TWENTY_FOUR_HOUR_BRANDS.some((known) => brand.includes(known))) {
      return { status: "typical-open", text: "Typically open 24 hours" };
    }
  }
  return null;
}

function categoryFor(tags: Record<string, string>): NearbyCategory | null {
  if (tags.amenity === "fuel") return "gas";
  if (tags.amenity === "hospital") return "hospital";
  if (tags.tourism === "hotel" || tags.tourism === "motel") return "lodging";
  if (tags.amenity === "fast_food" || tags.amenity === "restaurant") return "food";
  return null;
}

// Picking "closest" alone can surface a closed gas station over an open one a mile farther, or a
// 15-bed critical-access ER over a 400-bed trauma center a few miles out. Rank candidates instead:
// confirmed-open beats everything (owner: "confirmed open is like ideal ideal"), closed is worst
// (showing a closed business as the pick is actively unhelpful), and for hospitals specifically,
// bed count breaks ties as a free, defensible proxy for capability -- OSM has no rating system,
// but larger facilities reported via the `beds` tag are a reasonable "more capable" signal.
// Distance is always the final tiebreaker within a tier, so this never sends someone dramatically
// out of their way chasing a marginal upgrade.
const HOURS_RANK: Record<NearbyPlace["hoursStatus"], number> = {
  open: 0,
  "typical-open": 1,
  unknown: 2,
  closed: 3,
};

function bestCandidate(category: NearbyCategory, candidates: NearbyPlace[]): NearbyPlace | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const hoursDelta = HOURS_RANK[a.hoursStatus] - HOURS_RANK[b.hoursStatus];
    if (hoursDelta !== 0) return hoursDelta;
    if (category === "hospital") {
      const bedsDelta = (b.beds ?? 0) - (a.beds ?? 0);
      if (bedsDelta !== 0) return bedsDelta;
    }
    return a.distanceMiles - b.distanceMiles;
  });
  return sorted[0];
}

export async function getNearbyPlaces(pos: Position): Promise<{ places: Partial<Record<NearbyCategory, NearbyPlace>>; error: string }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(buildQuery(pos))}`,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = (await response.json()) as { elements?: OverpassNode[] };
    const now = new Date();
    const candidatesByCategory: Record<NearbyCategory, NearbyPlace[]> = { gas: [], hospital: [], lodging: [], food: [] };

    for (const node of data.elements ?? []) {
      const tags = node.tags ?? {};
      const name = tags.name;
      if (!name) continue;
      const category = categoryFor(tags);
      if (!category) continue;
      const distance = distanceMiles(pos, { lat: node.lat, lon: node.lon });
      const resolved = resolveOpeningHours(tags.opening_hours, now);
      const hours = resolved.status === "unknown" ? (inferTypicalHours(category, tags) ?? resolved) : resolved;
      const beds = Number(tags.beds);
      candidatesByCategory[category].push({
        id: `${node.id}`,
        category,
        name,
        distanceMiles: distance,
        lat: node.lat,
        lon: node.lon,
        address: formatAddress(tags),
        phone: tags.phone || tags["contact:phone"] || "",
        hoursStatus: hours.status,
        hoursText: hours.text,
        beds: Number.isFinite(beds) && beds > 0 ? beds : null,
      });
    }

    const places: Partial<Record<NearbyCategory, NearbyPlace>> = {};
    for (const category of Object.keys(candidatesByCategory) as NearbyCategory[]) {
      const best = bestCandidate(category, candidatesByCategory[category]);
      if (best) places[category] = best;
    }

    return { places, error: "" };
  } catch (error) {
    return { places: {}, error: error instanceof Error ? error.message : "Nearby lookup failed" };
  } finally {
    window.clearTimeout(timer);
  }
}
