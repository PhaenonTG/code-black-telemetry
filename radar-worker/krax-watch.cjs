// Temporary, conservative KRAX completed-volume watch. No TDS confirmation is issued.
// One systemd timer invocation at a time; durable key state prevents duplicate scans.
const fs = require("fs");
const path = require("path");

const SITE = "KRAX";
const LAT = 35.6656;
const LON = -78.4897;
const BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com";
const DATA = process.env.KRAX_WATCH_DATA || "/srv/codeblack/data/radar-worker/krax-watch";
const STATE = path.join(DATA, "state.json");
const LOG = path.join(DATA, "scans.jsonl");
const TIMEOUT = 25000;
const MOMENTS = {
  REF: "getHighresReflectivity",
  VEL: "getHighresVelocity",
  CC: "getHighresCorrelationCoefficient",
  ZDR: "getHighresDiffReflectivity",
  SW: "getHighresSpectrum",
};

async function fetchBounded(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "CodeBlack-KRAX-watch/1.0 (ops@codeblackwx.com)" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally { clearTimeout(timeout); }
}

function prefix(date) {
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${SITE}/`;
}

async function listKeys() {
  const days = [new Date(Date.now() - 86400000), new Date()];
  const keys = [];
  for (const date of days) {
    const response = await fetchBounded(`${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix(date))}&max-keys=1000`);
    const xml = await response.text();
    if (/<IsTruncated>true<\/IsTruncated>/.test(xml)) throw new Error("S3 listing truncated; cannot guarantee every volume");
    for (const match of xml.matchAll(/<Key>(.*?)<\/Key>/g)) {
      const key = match[1].replace(/&amp;/g, "&");
      if (/V0[368]$/.test(key)) keys.push(key);
    }
  }
  return [...new Set(keys)].sort();
}

function readState() {
  let state;
  try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); }
  catch { state = { lastKey: null, previousCandidates: [], initialized: false }; }
  // If the process died after appending a result but before the atomic state
  // rename, recover the durable scan key from the log instead of decoding twice.
  try {
    const lines = fs.readFileSync(LOG, "utf8").trim().split("\n");
    const last = JSON.parse(lines.at(-1));
    if (last.key && (!state.lastKey || last.key > state.lastKey)) {
      state.lastKey = last.key;
      state.initialized = true;
      state.previousCandidates = (last.candidates || []).map((c) => ({
        coordinates: c.coordinates, scanTime: last.scanTime,
        lowCcReflectivity: c.reflectivityDbz >= 35 && c.cc < 0.85,
      }));
    }
  } catch { /* no complete logged scan yet */ }
  return state;
}

function saveState(state) {
  const temp = `${STATE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state));
  fs.renameSync(temp, STATE);
}

function append(record) {
  fs.appendFileSync(LOG, JSON.stringify(record) + "\n");
  console.log(JSON.stringify(record));
}

function moment(radar, name) {
  try {
    const rows = radar[MOMENTS[name]]();
    return Array.isArray(rows) && rows.some((row) => row && row.moment_data && row.moment_data.length) ? rows : null;
  } catch { return null; }
}

function gate(row, rangeKm) {
  if (!row || !row.moment_data || !Number.isFinite(row.gate_size) || row.gate_size <= 0) return NaN;
  const i = Math.round((rangeKm - row.first_gate) / row.gate_size);
  return i >= 0 && i < row.moment_data.length ? Number(row.moment_data[i]) : NaN;
}

function nearIndex(azimuths, target) {
  let best = -1, gap = 360;
  for (let i = 0; i < azimuths.length; i++) {
    const d = Math.abs(((Number(azimuths[i]) - target + 540) % 360) - 180);
    if (d < gap) { best = i; gap = d; }
  }
  return gap <= 1.5 ? best : -1;
}

function locate(bearing, rangeKm) {
  const rad = bearing * Math.PI / 180;
  return [LON + rangeKm * Math.sin(rad) / (111.32 * Math.cos(LAT * Math.PI / 180)),
    LAT + rangeKm * Math.cos(rad) / 111.32];
}

function distanceKm(a, b) {
  const y = (a[1] - b[1]) * 111.32;
  const x = (a[0] - b[0]) * 111.32 * Math.cos(LAT * Math.PI / 180);
  return Math.hypot(x, y);
}

function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a[1] > point[1]) !== (b[1] > point[1])) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function inPolygon(point, geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return false;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => rings.length && inRing(point, rings[0]) &&
    !rings.slice(1).some((hole) => inRing(point, hole)));
}

async function warningPolygons() {
  try {
    const response = await fetchBounded("https://api.weather.gov/alerts/active?event=Tornado%20Warning");
    const data = await response.json();
    return { available: true, fetchedAt: new Date().toISOString(),
      features: (data.features || []).filter((f) => f.geometry && f.properties?.event === "Tornado Warning") };
  } catch (error) {
    return { available: false, error: String(error.message || error), features: [] };
  }
}

function candidatesFrom(radar, products, azimuths, previous, scanTime, warnings) {
  const rows = products.VEL;
  if (!rows || !products.REF || !products.CC) return [];
  const velAzimuths = Array.isArray(azimuths) ? azimuths : azimuths.velocity;
  const refAzimuths = Array.isArray(azimuths) ? azimuths : azimuths.reflectivity;
  const out = [];
  // Neighboring velocity radials at equal range: a gate-level screening heuristic,
  // not a meteorologist's interpretation or a tornado detection.
  for (let i = 0; i < rows.length; i++) {
    const next = (i + 1) % rows.length;
    const a = Number(velAzimuths[i]), b = Number(velAzimuths[next]);
    const separation = ((b - a + 360) % 360);
    if (!(separation > 0 && separation <= 2)) continue;
    const bearing = (a + separation / 2) % 360;
    const refIndex = nearIndex(refAzimuths, bearing);
    if (refIndex < 0) continue;
    for (let km = 5; km <= 150; km += 2) {
      const v1 = gate(rows[i], km), v2 = gate(rows[next], km);
      if (!Number.isFinite(v1) || !Number.isFinite(v2) || v1 * v2 >= 0 ||
          Math.min(Math.abs(v1), Math.abs(v2)) < 12 || Math.abs(v1 - v2) < 35) continue;
      const ref = gate(products.REF[refIndex], km);
      const cc = gate(products.CC[refIndex], km);
      if (!Number.isFinite(ref) || ref < 30 || !Number.isFinite(cc)) continue;
      const point = locate(bearing, km);
      const matchingPrevious = previous.find((p) => Math.abs(Date.parse(scanTime) - Date.parse(p.scanTime)) <= 12 * 60000 &&
        distanceKm(point, p.coordinates) <= 10);
      const prev = Boolean(matchingPrevious);
      const warning = warnings.features.find((f) => inPolygon(point, f.geometry));
      const zdr = products.ZDR ? gate(products.ZDR[refIndex], km) : NaN;
      const sw = products.SW ? gate(products.SW[nearIndex(velAzimuths, bearing)], km) : NaN;
      const candidate = {
        coordinates: point.map((x) => Number(x.toFixed(4))), rangeKm: km,
        bearingDeg: Number(bearing.toFixed(1)), velocityPairKt: [v1, v2].map((x) => Number(x.toFixed(1))),
        shearKt: Number(Math.abs(v1 - v2).toFixed(1)), reflectivityDbz: Number(ref.toFixed(1)),
        cc: Number(cc.toFixed(3)), zdrDb: Number.isFinite(zdr) ? Number(zdr.toFixed(2)) : null,
        spectrumWidth: Number.isFinite(sw) ? Number(sw.toFixed(1)) : null,
        warningId: warning?.id || null, temporallyPersistent: prev, scanTime,
        classification: prev ? "candidate_low_level_rotation" : "single_scan_couplet",
        potentialTds: matchingPrevious?.lowCcReflectivity && ref >= 35 && cc < 0.85
          ? "candidate_only_requires_human_review" : null,
        confidence: prev && warning ? "moderate" : "low",
      };
      if (!out.some((p) => distanceKm(p.coordinates, point) < 8)) out.push(candidate);
      if (out.length >= 30) return out;
    }
  }
  return out;
}

async function analyze(key, previous) {
  const { Level2Radar } = require("nexrad-level-2-data");
  const started = Date.now();
  const response = await fetchBounded(`${BUCKET}/${key}`);
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > 50 * 1024 * 1024) throw new Error("Volume exceeds 50 MiB safety limit");
  const radar = new Level2Radar(raw, { logger: false });
  const elevations = radar.listElevations();
  if (!elevations.length) throw new Error("No decoded elevations");
  let analyzedTilt = elevations[0];
  const tiltAvailability = [];
  const cuts = [];
  for (const tilt of elevations.slice(0, 5)) {
    radar.setElevation(tilt);
    const atTilt = Object.fromEntries(Object.keys(MOMENTS).map((name) => [name, moment(radar, name)]));
    const headers = radar.getHeader();
    const angle = Number((Array.isArray(headers) ? headers[0] : headers)?.elevation_angle);
    const cut = { tilt, angle: Number.isFinite(angle) ? angle : null, products: atTilt,
      azimuths: radar.getAzimuth() };
    cuts.push(cut);
    tiltAvailability.push({ tilt, elevationAngle: cut.angle,
      products: Object.fromEntries(Object.entries(atTilt).map(([name, rows]) => [name, Boolean(rows)])) });
  }
  const reflectCut = cuts.find((c) => c.products.REF && c.products.CC) || cuts[0];
  const velocityCut = cuts.filter((c) => c.products.VEL &&
    (c.tilt === reflectCut.tilt || (c.angle !== null && reflectCut.angle !== null &&
      Math.abs(c.angle - reflectCut.angle) <= 0.2 && Math.abs(c.tilt - reflectCut.tilt) <= 2)))
    .sort((a, b) => Math.abs(a.angle - reflectCut.angle) - Math.abs(b.angle - reflectCut.angle))[0] || null;
  analyzedTilt = reflectCut.tilt;
  const products = { REF: reflectCut.products.REF, CC: reflectCut.products.CC,
    ZDR: reflectCut.products.ZDR, VEL: velocityCut?.products.VEL || null,
    SW: velocityCut?.products.SW || null };
  const azimuths = { reflectivity: reflectCut.azimuths, velocity: velocityCut?.azimuths || [] };
  const scanTime = new Date(Date.UTC(1970, 0, 1) + ((radar.header?.modified_julian_date ?? 0) - 1) * 86400000 +
    (radar.header?.milliseconds ?? 0)).toISOString();
  const warnings = await warningPolygons();
  const candidates = candidatesFrom(radar, products, azimuths, previous, scanTime, warnings);
  const record = {
    site: SITE, key, scanTime, processedAt: new Date().toISOString(),
    processingMs: Date.now() - started, lowestTilt: elevations[0], analyzedTilt,
    pairedVelocityTilt: velocityCut?.tilt || null,
    elevationSeparationDeg: velocityCut ? Number(Math.abs(velocityCut.angle - reflectCut.angle).toFixed(2)) : null,
    tiltAvailability,
    availableProducts: Object.fromEntries(Object.entries(products).map(([name, rows]) => [name, Boolean(rows)])),
    srv: { available: false, reason: "storm motion not set; do not invent SRV" },
    warnings: { available: warnings.available, fetchedAt: warnings.fetchedAt || null,
      count: warnings.features.length, error: warnings.error || null },
    radarLimitations: ["Lowest five tilts checked; split moments paired only within 0.2 degree elevation",
      "Candidate screening limited to 5-150 km from KRAX", "Beam height/range may miss low-level circulation",
      "Velocity aliasing and nonmeteorological echoes not dealiased", "Candidate screen is not a tornado diagnosis",
      "TDS cannot be confirmed automatically from this screen"],
    candidates, confidence: candidates.some((c) => c.confidence === "moderate") ? "moderate" : "low",
    tdsConfirmed: false,
  };
  return record;
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true, mode: 0o750 });
  const state = readState();
  const keys = await listKeys();
  if (!keys.length) throw new Error("No KRAX complete volumes listed");
  if (!state.initialized) {
    state.lastKey = keys.length > 1 ? keys.at(-2) : null;
    state.initialized = true;
    saveState(state);
  }
  const pending = keys.filter((key) => !state.lastKey || key > state.lastKey).slice(0, 4);
  for (const key of pending) {
    const record = await analyze(key, state.previousCandidates || []);
    append(record);
    state.lastKey = key;
    state.previousCandidates = record.candidates.map((c) => ({
      coordinates: c.coordinates, scanTime: record.scanTime,
      lowCcReflectivity: c.reflectivityDbz >= 35 && c.cc < 0.85,
    }));
    saveState(state);
  }
  if (!pending.length) console.log(JSON.stringify({ site: SITE, status: "no_new_complete_volume",
    checkedAt: new Date().toISOString(), lastKey: state.lastKey }));
}

if (require.main === module) {
  main().catch((error) => { console.error(JSON.stringify({ site: SITE, error: String(error.message || error),
    checkedAt: new Date().toISOString() })); process.exitCode = 1; });
}

module.exports = { gate, nearIndex, inPolygon, candidatesFrom, analyze };
