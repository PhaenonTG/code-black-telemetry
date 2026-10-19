export type StormReport = {
  id: string; event: string; location: string; county: string; state: string;
  source: string; details: string; magnitude: string | null; occurredAt: string;
  latitude: number | null; longitude: number | null; office: string; productUrl: string;
};

const offices = ["MOB", "LIX", "TAE", "JAN"] as const;
const nws = "https://api.weather.gov";
const offsets: Record<string, number> = { CDT: 5, CST: 6, EDT: 4, EST: 5 };

const asUtc = (date: string, time: string, zone: string): string | null => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  if (!match || !(zone in offsets)) return null;
  let hour = Number(time.slice(0, 2)) % 12;
  if (time.slice(5, 7) === "PM") hour += 12;
  const value = new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), hour + offsets[zone], Number(time.slice(2, 4))));
  return Number.isNaN(value.valueOf()) ? null : value.toISOString();
};

export function parseLsrProduct(text: string, office: string, productUrl: string): StormReport[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const zone = /\b(CDT|CST|EDT|EST)\b/.exec(text.slice(0, 500))?.[1] ?? "";
  const rows: StormReport[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const first = lines[i];
    if (!/^\d{4} [AP]M\s/.test(first) || first.length < 52) continue;
    const second = lines[i + 1];
    if (!/^\d{2}\/\d{2}\/\d{4}\s/.test(second) || second.length < 51) continue;
    const occurredAt = asUtc(second.slice(0, 10), first.slice(0, 7), zone);
    const event = first.slice(12, 29).trim(), location = first.slice(29, 53).trim();
    if (!occurredAt || !event || !location) continue;
    const point = /^(\d{1,2}\.\d{2})([NS])\s+(\d{1,3}\.\d{2})([EW])/.exec(first.slice(53).trim());
    const latitude = point ? Number(point[1]) * (point[2] === "S" ? -1 : 1) : null;
    const longitude = point ? Number(point[3]) * (point[4] === "W" ? -1 : 1) : null;
    const state = second.slice(48, 50).trim();
    const details: string[] = [];
    let cursor = i + 2;
    while (cursor < lines.length && !/^\d{4} [AP]M\s/.test(lines[cursor]) && !/^\s*(?:&&|\$\$)/.test(lines[cursor])) {
      const value = lines[cursor].trim();
      if (value) details.push(value);
      cursor++;
    }
    rows.push({ id: `${office}-${occurredAt}-${event}-${latitude}-${longitude}-${location}`,
      event, location, county: second.slice(29, 48).trim(), state,
      source: second.slice(53).trim() || `NWS ${office}`, details: details.join(" "),
      magnitude: second.slice(12, 29).trim() || null, occurredAt, latitude, longitude,
      office, productUrl });
    i = cursor - 1;
  }
  return rows;
}

type ProductListing = { "@graph"?: { id?: string; issuanceTime?: string }[] };
type ProductBody = { productText?: string };
const fetchJson = async <T,>(url: string, signal: AbortSignal): Promise<T> => {
  const response = await fetch(url, { headers: { Accept: "application/ld+json" }, signal });
  if (!response.ok) throw new Error(`NWS returned ${response.status}`);
  return response.json() as Promise<T>;
};

export async function fetchStormReports(signal: AbortSignal, hours: 24 | 72 | 168 = 72): Promise<{ reports: StormReport[]; failedOffices: string[]; checkedAt: string }> {
  const cutoff = Date.now() - hours * 60 * 60_000;
  const results = await Promise.allSettled(offices.map(async (office) => {
    const listing = await fetchJson<ProductListing>(`${nws}/products/types/LSR/locations/${office}`, signal);
    const recent = (listing["@graph"] ?? []).filter((item) => item.id && item.issuanceTime && Date.parse(item.issuanceTime) >= cutoff);
    const products = await Promise.allSettled(recent.map(async (item) => {
      const url = `${nws}/products/${encodeURIComponent(item.id!)}`;
      const body = await fetchJson<ProductBody>(url, signal);
      return parseLsrProduct(body.productText ?? "", office, url);
    }));
    return { office, rows: products.flatMap((result) => result.status === "fulfilled" ? result.value : []), failed: products.some((result) => result.status === "rejected") };
  }));
  const failedOffices = results.flatMap((result, index) => result.status === "rejected" || result.value.failed ? [offices[index]] : []);
  const unique = new Map<string, StormReport>();
  for (const result of results) if (result.status === "fulfilled") for (const row of result.value.rows) {
    if (Date.parse(row.occurredAt) >= cutoff && !unique.has(row.id)) unique.set(row.id, row);
  }
  return { reports: [...unique.values()].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)), failedOffices, checkedAt: new Date().toISOString() };
}

export function timeAgo(value: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (!Number.isFinite(minutes)) return "Time unavailable";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
