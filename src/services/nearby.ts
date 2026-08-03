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

// The main public instance (overpass-api.de) is shared, free, and confirmed live to occasionally
// 504 under load ("The server is probably too busy to handle your request") -- a second public
// mirror as fallback turns that into a same-attempt recovery instead of waiting out the retry
// backoff in useNearbyPlaces.ts for a server that was never going to answer this round anyway.
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const SEARCH_RADIUS_METERS = 40_000; // ~25 miles

// Hospital: restrict to amenity=hospital elements explicitly tagged emergency=yes. A plain
// "hospital" match can be misleading in the field -- confirmed live against Overpass near a test
// location: a rehab hospital and a couple of others are tagged emergency=no, meaning no ER, while
// most full-service hospitals nearby (11 of 14 checked) do carry emergency=yes. Untagged/
// unconfirmed hospitals are deliberately excluded rather than guessed at -- the point of this
// filter is to stop showing a non-ER facility as "the hospital" during what might be a real
// emergency.
//
// Filters (not full node[...] query strings) so buildQuery can search both node AND way for each
// -- confirmed live via Overpass that real, major, well-known hospitals get mapped as a `way`
// (the building footprint) rather than a point node just as often as smaller ones get mapped as a
// node. A node-only query was silently dropping those from consideration entirely (e.g. a real
// 200-bed hospital never showing up as a candidate, losing out to a 25-bed one 8 miles farther
// away purely because of how each happened to be digitized in OSM, not because of anything about
// the hospitals themselves).
const CATEGORY_FILTERS: Record<NearbyCategory, string[]> = {
  gas: ['["amenity"="fuel"]'],
  hospital: ['["amenity"="hospital"]["emergency"="yes"]'],
  lodging: ['["tourism"="hotel"]', '["tourism"="motel"]'],
  food: ['["amenity"="fast_food"]', '["amenity"="restaurant"]'],
};

interface OverpassNode {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function buildQuery(pos: Position): string {
  const around = `(around:${SEARCH_RADIUS_METERS},${pos.lat.toFixed(5)},${pos.lon.toFixed(5)})`;
  const clauses = Object.values(CATEGORY_FILTERS)
    .flat()
    .flatMap((filter) => [`node${filter}${around};`, `way${filter}${around};`])
    .join("\n  ");
  // "center" gives ways/relations a computed lat/lon (a plain node already has one); "body"
  // brings the tags needed to name/categorize/rank each result.
  return `[out:json][timeout:20];\n(\n  ${clauses}\n);\nout body center;`;
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
// bed count breaks a genuine near-tie in distance as a free, defensible proxy for capability --
// OSM has no rating system, but larger facilities reported via the `beds` tag are a reasonable
// "more capable" signal. Confirmed live this needs a real gate, not just "checked before
// distance": with beds unconditionally ahead of distance, a 400-bed hospital 24 miles out beat a
// 200-bed hospital 10 miles out for "closest ER" -- the opposite of what a critical, time-sensitive
// lookup should ever do. Beds only breaks a tie when the distance gap is genuinely small; beyond
// that, closer always wins outright.
const HOURS_RANK: Record<NearbyPlace["hoursStatus"], number> = {
  open: 0,
  "typical-open": 1,
  unknown: 2,
  closed: 3,
};
const HOSPITAL_BEDS_TIEBREAK_MILES = 3;

function bestCandidate(category: NearbyCategory, candidates: NearbyPlace[]): NearbyPlace | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const hoursDelta = HOURS_RANK[a.hoursStatus] - HOURS_RANK[b.hoursStatus];
    if (hoursDelta !== 0) return hoursDelta;
    if (category === "hospital" && Math.abs(a.distanceMiles - b.distanceMiles) <= HOSPITAL_BEDS_TIEBREAK_MILES) {
      const bedsDelta = (b.beds ?? 0) - (a.beds ?? 0);
      if (bedsDelta !== 0) return bedsDelta;
    }
    return a.distanceMiles - b.distanceMiles;
  });
  return sorted[0];
}

async function fetchOverpassElements(url: string, query: string): Promise<OverpassNode[]> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = (await response.json()) as { elements?: OverpassNode[] };
    return data.elements ?? [];
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getNearbyPlaces(pos: Position): Promise<{ places: Partial<Record<NearbyCategory, NearbyPlace>>; error: string }> {
  const query = buildQuery(pos);
  let elements: OverpassNode[] | null = null;
  let lastError = "";
  for (const url of OVERPASS_URLS) {
    try {
      elements = await fetchOverpassElements(url, query);
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Nearby lookup failed";
    }
  }
  if (elements == null) return { places: {}, error: lastError || "Nearby lookup failed" };

  try {
    const now = new Date();
    const candidatesByCategory: Record<NearbyCategory, NearbyPlace[]> = { gas: [], hospital: [], lodging: [], food: [] };

    for (const node of elements) {
      const tags = node.tags ?? {};
      const name = tags.name;
      if (!name) continue;
      const category = categoryFor(tags);
      if (!category) continue;
      // Nodes carry lat/lon directly; ways/relations only have it via the "center" output modifier.
      const point = node.lat != null && node.lon != null ? { lat: node.lat, lon: node.lon } : node.center;
      if (!point) continue;
      const distance = distanceMiles(pos, point);
      const resolved = resolveOpeningHours(tags.opening_hours, now);
      const hours = resolved.status === "unknown" ? (inferTypicalHours(category, tags) ?? resolved) : resolved;
      const beds = Number(tags.beds);
      candidatesByCategory[category].push({
        id: `${node.type}/${node.id}`,
        category,
        name,
        distanceMiles: distance,
        lat: point.lat,
        lon: point.lon,
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
  }
}
