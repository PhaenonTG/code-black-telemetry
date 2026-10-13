// Warning-triggered radar evidence workflow. This is a supplemental screen,
// not an NWS warning, tornado diagnosis, probability forecast, or TDS confirmation.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { analyze, listKeys, inPolygon } = require("./krax-watch.cjs");

const NWS = "https://api.weather.gov/alerts/active";
const SITES = "https://gis.ncdc.noaa.gov/arcgis/rest/services/cdo/nexrad/MapServer/0/query?where=1%3D1&outFields=STATION_ID%2CSTATION_NAME%2CLATITUDE%2CLONGITUDE%2CEND_DATE&returnGeometry=false&f=geojson";
const USER_AGENT = "CodeBlack-Aegis-Radar/0.1 (ops@codeblackwx.com)";
const EVENTS = new Set(["Tornado Warning", "Severe Thunderstorm Warning"]);
const DEFAULTS = Object.freeze({ evidence_cutoff: 85, max_sites: 6, max_warnings: 20,
  max_volume_age_seconds: 600, max_range_km: 140, enabled: false });

async function json(url, timeoutMs = 15000) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { signal, headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" } });
  if (!response.ok) throw new Error(`upstream HTTP ${response.status}`);
  return response.json();
}

function config(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = { ...DEFAULTS, ...source };
  if (!Number.isInteger(result.evidence_cutoff) || result.evidence_cutoff < 70 || result.evidence_cutoff > 100)
    throw new Error("evidence_cutoff must be an integer from 70 through 100");
  for (const key of ["max_sites", "max_warnings", "max_volume_age_seconds", "max_range_km"])
    if (!Number.isFinite(result[key]) || result[key] < 1) throw new Error(`invalid ${key}`);
  result.max_sites = Math.min(8, Math.floor(result.max_sites));
  result.max_warnings = Math.min(30, Math.floor(result.max_warnings));
  result.max_volume_age_seconds = Math.min(900, Math.floor(result.max_volume_age_seconds));
  result.max_range_km = Math.min(150, Math.floor(result.max_range_km));
  result.enabled = result.enabled === true;
  return result;
}

function warning(feature, nowMs = Date.now()) {
  const p = feature?.properties || {};
  if (!EVENTS.has(p.event) || String(p.status || "").toLowerCase() !== "actual" ||
      !feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) return null;
  const expiresMs = Date.parse(p.expires);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return null;
  const id = String(feature.id || p.id || "");
  if (!/^https:\/\/api\.weather\.gov\/alerts\//.test(id)) return null;
  return { id, event: p.event, sent: p.sent || null, expires: p.expires,
    headline: String(p.headline || p.event).slice(0, 300), geometry: feature.geometry,
    source: "NWS", source_url: id };
}

async function activeWarnings(nowMs = Date.now()) {
  const [tornado, severe] = await Promise.all([
    json(`${NWS}?event=Tornado%20Warning`),
    json(`${NWS}?event=Severe%20Thunderstorm%20Warning`),
  ]);
  const seen = new Set();
  return [...(tornado.features || []), ...(severe.features || [])].map((f) => warning(f, nowMs))
    .filter((w) => w && !seen.has(w.id) && seen.add(w.id))
    .sort((a, b) => Number(b.event === "Tornado Warning") - Number(a.event === "Tornado Warning") ||
      Date.parse(b.sent || 0) - Date.parse(a.sent || 0));
}

function radarSites(document, nowMs = Date.now()) {
  return (document?.features || []).map((feature) => {
    const p = feature.properties || {};
    const id = String(p.STATION_ID || "").replace(/^NEXRAD:/, "");
    const lat = Number(p.LATITUDE), lon = Number(p.LONGITUDE), end = Number(p.END_DATE);
    // The NOAA layer also contains TDWR (T-prefix) sites; those are not in
    // the WSR-88D Level II bucket consumed by this decoder. TJUA is WSR-88D.
    return (/^[KP][A-Z0-9]{3}$/.test(id) || id === "TJUA") && Number.isFinite(lat) && Number.isFinite(lon) &&
      lat > 15 && lat < 72 && lon > -180 && lon < -60 && (!Number.isFinite(end) || end > nowMs)
      ? { id, lat, lon, name: String(p.STATION_NAME || id) } : null;
  }).filter(Boolean);
}

function allPoints(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((rings) => rings[0] || []).filter((point) =>
    Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function distanceToWarningKm(site, geometry) {
  const point = [site.lon, site.lat];
  if (inPolygon(point, geometry)) return 0;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const scaleX = 111.32 * Math.cos(site.lat * Math.PI / 180);
  let closest = Infinity;
  for (const rings of polygons) {
    const ring = rings[0] || [];
    for (let i = 1; i < ring.length; i++) {
      const a = [(ring[i - 1][0] - site.lon) * scaleX, (ring[i - 1][1] - site.lat) * 111.32];
      const b = [(ring[i][0] - site.lon) * scaleX, (ring[i][1] - site.lat) * 111.32];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
      closest = Math.min(closest, Math.hypot(a[0] + t * dx, a[1] + t * dy));
    }
  }
  return closest;
}

function siteFor(w, sites, excluded = new Set()) {
  const points = allPoints(w.geometry);
  if (!points.length) return null;
  return sites.filter((site) => !excluded.has(site.id)).map((site) => ({ site,
    distance: distanceToWarningKm(site, w.geometry) }))
    .sort((a, b) => a.distance - b.distance)[0] || null;
}

function scoreRecordedEvidence(candidate, record, cfg, nowMs = Date.now()) {
  if (!candidate || !candidate.warningId) return null;
  const scanAge = (nowMs - Date.parse(record.scanTime)) / 1000;
  if (!Number.isFinite(scanAge) || scanAge < -60 || scanAge > cfg.max_volume_age_seconds ||
      !candidate.temporallyPersistent || candidate.rangeKm > cfg.max_range_km ||
      candidate.shearKt < 45 || candidate.reflectivityDbz < 35 ||
      !record.availableProducts?.VEL || !record.availableProducts?.REF || !record.availableProducts?.CC ||
      !Number.isFinite(record.elevationSeparationDeg) || record.elevationSeparationDeg > 0.2) return null;
  const tilt = record.tiltAvailability?.find((x) => x.tilt === record.analyzedTilt);
  if (!tilt || tilt.elevationAngle === null || tilt.elevationAngle > 1.0) return null;
  // A transparent, *uncalibrated evidence score*; never present as an event probability.
  const factors = ["NWS warning polygon", "persistent low-level velocity couplet", "colocated reflectivity"];
  let score = 75;
  if (candidate.shearKt >= 60) { score += 10; factors.push("stronger velocity contrast"); }
  if (candidate.cc < 0.9) { score += 10; factors.push("low correlation coefficient"); }
  if (candidate.zdrDb !== null && candidate.zdrDb <= 1) { score += 5; factors.push("low differential reflectivity"); }
  return { score: Math.min(100, score), factors, scanAgeSeconds: Math.round(scanAge),
    aboveCutoff: score >= cfg.evidence_cutoff };
}

function evidence(candidate, record, w, cfg, nowMs = Date.now()) {
  if (!candidate || candidate.warningId !== w.id || !inPolygon(candidate.coordinates, w.geometry)) return null;
  return scoreRecordedEvidence(candidate, record, cfg, nowMs);
}

function alert(w, site, record, candidate, rating, cfg) {
  const id = crypto.createHash("sha256").update([w.id, record.key,
    candidate.coordinates.join(",")].join("|")).digest("hex").slice(0, 24);
  return { schema: "codeblack.fabric.aegis-radar-alert.v1", id, created_at: new Date().toISOString(),
    status: "supplemental_unconfirmed_radar_candidate", official_warning: {
      id: w.id, event: w.event, headline: w.headline, sent: w.sent, expires: w.expires,
      source_url: w.source_url, geometry: w.geometry },
    radar: { site: site.id, volume_key: record.key, scan_time: record.scanTime,
      processed_at: record.processedAt, analyzed_tilt: record.analyzedTilt,
      available_products: record.availableProducts, limitations: record.radarLimitations },
    rating: { evidence_score: rating.score, cutoff: cfg.evidence_cutoff,
      calibrated_probability: null, factors: rating.factors },
    candidate: { ...candidate, potentialTds: candidate.potentialTds || null,
      tdsConfirmed: false },
    map: { type: "FeatureCollection", features: [
      { type: "Feature", geometry: w.geometry, properties: { kind: "official_warning", event: w.event, id: w.id } },
      { type: "Feature", geometry: { type: "Point", coordinates: candidate.coordinates },
        properties: { kind: "unconfirmed_radar_candidate", alert_id: id,
          evidence_score: rating.score, site: site.id, scan_time: record.scanTime } },
    ] },
    disclaimer: "Experimental radar screen, not a tornado confirmation or substitute for NWS warnings." };
}

function tailLines(file, maxBytes = 4 * 1024 * 1024) {
  let descriptor;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    descriptor = fs.openSync(file, "r");
    fs.readSync(descriptor, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return (start ? text.slice(text.indexOf("\n") + 1) : text).trim().split("\n").filter(Boolean);
  } catch { return []; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function loadState(dir) {
  let state;
  try { state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")); }
  catch { state = { version: 1, sites: {}, emitted: [] }; }
  state.sites ||= {};
  state.emitted ||= [];
  // Recover committed journal rows if a process died before replacing state.
  try {
    for (const line of tailLines(path.join(dir, "alerts.jsonl"))) {
      const event = JSON.parse(line); if (event.id) state.emitted.push(event.id);
      if (Number.isInteger(event.sequence)) state.nextSequence = Math.max(state.nextSequence || 0, event.sequence);
    }
  } catch { /* no completed alert journal yet */ }
  try {
    for (const line of tailLines(path.join(dir, "scans.jsonl"))) {
      const scan = JSON.parse(line); if (!scan.site || !scan.key) continue;
      const current = state.sites[scan.site] || { lastKey: null, previousCandidates: [] };
      if (!current.lastKey || scan.key > current.lastKey) state.sites[scan.site] = {
        lastKey: scan.key, previousCandidates: (scan.candidates || []).map((c) => ({
          coordinates: c.coordinates, scanTime: scan.scanTime,
          lowCcReflectivity: c.reflectivityDbz >= 35 && c.cc < 0.85,
        })) };
    }
  } catch { /* no completed scan journal yet */ }
  state.emitted = [...new Set(state.emitted)].slice(-2000);
  return state;
}
function saveState(dir, state) {
  const file = path.join(dir, "state.json");
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state)); fs.renameSync(temp, file);
}
function append(dir, name, record) {
  fs.appendFileSync(path.join(dir, name), JSON.stringify(record) + "\n");
}

async function run({ dir, cfg, fetchWarnings = activeWarnings, fetchSites = () => json(SITES),
  keysForSite = listKeys, analyzeVolume = analyze, nowMs = Date.now() }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const settings = config(cfg);
  const status = { schema: "codeblack.aegis-radar-status.v1", checked_at: new Date(nowMs).toISOString(),
    enabled: settings.enabled, cutoff: settings.evidence_cutoff, warnings: 0, sites: [],
    new_volumes: 0, qualified_alerts: 0, suppressed: 0, errors: [] };
  if (!settings.enabled) return status;
  const [warnings, siteData] = await Promise.all([fetchWarnings(nowMs), fetchSites()]);
  const sites = radarSites(siteData, nowMs);
  if (!sites.length) throw new Error("official radar station catalog unavailable");
  status.warnings = warnings.length;
  const chosen = new Map();
  for (const w of warnings.slice(0, settings.max_warnings)) {
    const best = siteFor(w, sites);
    if (best && best.distance <= settings.max_range_km &&
        (chosen.has(best.site.id) || chosen.size < settings.max_sites)) {
      const row = chosen.get(best.site.id) || { site: best.site, warnings: [] };
      row.warnings.push(w); chosen.set(best.site.id, row);
    } else status.suppressed++;
  }
  const state = loadState(dir);
  const emitted = new Set(state.emitted || []);
  for (const { site, warnings: relevant } of chosen.values()) {
    status.sites.push(site.id);
    try {
      const keys = await keysForSite(site.id);
      const siteState = state.sites[site.id] || { lastKey: null, previousCandidates: [] };
      // On a new warning, inspect the two latest complete volumes immediately
      // so persistence does not have to wait for another radar sweep.
      const pending = siteState.lastKey ? keys.filter((key) => key > siteState.lastKey).slice(0, 2)
        : keys.slice(-2);
      for (const key of pending) {
        const scan = await analyzeVolume(key, siteState.previousCandidates, site,
          { available: true, fetchedAt: new Date(nowMs).toISOString(), features: relevant.map((w) => ({ id: w.id,
            geometry: w.geometry, properties: { event: w.event } })) });
        // Preserve the official warning identities presented to this scan, even
        // when no candidate was found. Retrospective false-negative review
        // otherwise cannot identify the warned storm from scans.jsonl alone.
        scan.warningContext = relevant.map((w) => ({ id: w.id, event: w.event,
          sent: w.sent, expires: w.expires, source_url: w.source_url }));
        for (const candidate of scan.candidates) {
          const w = relevant.find((row) => row.id === candidate.warningId);
          if (!w) continue;
          const rating = evidence(candidate, scan, w, settings, nowMs);
          if (!rating) continue;
          if (!rating.aboveCutoff) { status.suppressed++; continue; }
          const event = alert(w, site, scan, candidate, rating, settings);
          if (emitted.has(event.id)) continue;
          event.sequence = (state.nextSequence || 0) + 1;
          state.nextSequence = event.sequence;
          append(dir, "alerts.jsonl", event); emitted.add(event.id); status.qualified_alerts++;
        }
        append(dir, "scans.jsonl", scan); status.new_volumes++;
        siteState.lastKey = key;
        siteState.previousCandidates = scan.candidates.map((c) => ({ coordinates: c.coordinates,
          scanTime: scan.scanTime, lowCcReflectivity: c.reflectivityDbz >= 35 && c.cc < 0.85 }));
        state.sites[site.id] = siteState;
        state.emitted = [...emitted].slice(-2000);
        saveState(dir, state);
      }
    } catch (error) { status.errors.push({ site: site.id, message: String(error.message || error) }); }
  }
  const temp = path.join(dir, `status.${process.pid}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(status)); fs.renameSync(temp, path.join(dir, "status.json"));
  return status;
}

if (require.main === module) {
  const dir = process.env.CODEBLACK_AEGIS_RADAR_DATA || "/srv/codeblack/data/radar-worker/aegis-warning";
  const configFile = process.env.CODEBLACK_AEGIS_RADAR_CONFIG || path.join(dir, "config.json");
  let settings;
  try { settings = JSON.parse(fs.readFileSync(configFile, "utf8")); }
  catch (error) { console.error(`configuration unavailable: ${error.message}`); process.exit(2); }
  run({ dir, cfg: settings }).then((result) => { console.log(JSON.stringify(result));
    if (result.errors.length) process.exitCode = 1; }).catch((error) => {
    console.error(String(error.message || error)); process.exitCode = 1; });
}

module.exports = { config, warning, radarSites, siteFor, scoreRecordedEvidence, evidence, alert, run };
