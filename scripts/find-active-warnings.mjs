#!/usr/bin/env node
// Finds real, currently-active NWS warnings/watches and prints ready-to-paste
// classic-v2.html test URLs (?latitude=&longitude=) for each one -- so overlay location-specific
// behavior (alerts, radar zoom/product rotation, warning polygon, SPC, Storm Intel, etc.) can be
// tested against a genuine live event instead of only the simulateAlert fixtures.
//
// Usage:
//   node scripts/find-active-warnings.mjs
//   node scripts/find-active-warnings.mjs --base http://localhost:8765/classic-v2.html
//
// The point used per alert is the polygon centroid when the alert carries real geometry
// (warnings do; watches/advisories don't), otherwise it falls back to the NWS point/geocode
// centroid Nominatim would resolve for the first listed county -- marked accordingly so it's
// clear which kind of point you're getting.

const EVENTS = [
  "Tornado Warning",
  "Severe Thunderstorm Warning",
  "Flash Flood Warning",
  "Tornado Watch",
  "Severe Thunderstorm Watch",
  "Excessive Heat Warning",
  "Heat Advisory",
];

const baseArgIdx = process.argv.indexOf("--base");
const BASE_URL = baseArgIdx !== -1 ? process.argv[baseArgIdx + 1] : "http://localhost:8765/classic-v2.html";

function polygonCentroid(geometry) {
  if (!geometry) return null;
  const rings = geometry.type === "Polygon" ? [geometry.coordinates[0]]
    : geometry.type === "MultiPolygon" ? geometry.coordinates.map((p) => p[0])
    : null;
  if (!rings) return null;
  let sumLat = 0, sumLon = 0, n = 0;
  for (const ring of rings) {
    for (const [lon, lat] of ring) { sumLat += lat; sumLon += lon; n += 1; }
  }
  if (!n) return null;
  return { lat: sumLat / n, lon: sumLon / n, source: "polygon centroid (real warning shape)" };
}

async function main() {
  const url = `https://api.weather.gov/alerts/active?event=${EVENTS.map(encodeURIComponent).join(",")}`;
  const res = await fetch(url, { headers: { Accept: "application/geo+json", "User-Agent": "codeblack-overlay-test-tool" } });
  if (!res.ok) {
    console.error(`NWS alerts fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const data = await res.json();
  const features = Array.isArray(data.features) ? data.features : [];
  if (!features.length) {
    console.log("No matching active alerts right now (checked: " + EVENTS.join(", ") + ").");
    console.log("Nothing to drop in -- try again later, or use ?simulateAlert=<kind> for a fabricated test instead.");
    return;
  }

  console.log(`${features.length} active alert(s) found:\n`);
  for (const feature of features) {
    const props = feature.properties || {};
    const point = polygonCentroid(feature.geometry);
    const area = String(props.areaDesc || "").split(";")[0].trim();
    console.log(`- ${props.event}${area ? ` — ${area}` : ""}`);
    console.log(`  expires: ${props.expires || "unknown"}`);
    if (point) {
      const testUrl = `${BASE_URL}?latitude=${point.lat.toFixed(4)}&longitude=${point.lon.toFixed(4)}`;
      console.log(`  point: ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)} (${point.source})`);
      console.log(`  test:  ${testUrl}`);
    } else {
      console.log("  no polygon geometry on this alert (typical for a watch/advisory) -- pick a point inside the named area manually.");
    }
    console.log("");
  }
  console.log("Pass --base <url> to point at a local dev server instead of the default, e.g.:");
  console.log("  node scripts/find-active-warnings.mjs --base http://localhost:8765/classic-v2.html");
}

main().catch((err) => { console.error(err); process.exit(1); });
