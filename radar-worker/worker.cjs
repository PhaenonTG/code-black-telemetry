const http = require("http");
const crypto = require("crypto");
const { PNG } = require("pngjs");
const { Level2Radar } = require("nexrad-level-2-data");
const parseLevel3 = require("nexrad-level-3-data");
const bzip = require("seek-bzip");
const { RandomAccessFile } = require("nexrad-level-3-data/src/randomaccessfile");
const textHeader = require("nexrad-level-3-data/src/headers/text");
const messageHeader = require("nexrad-level-3-data/src/headers/message");
const { parse: productDescription } = require("nexrad-level-3-data/src/headers/productdescription");
const symbologyHeader = require("nexrad-level-3-data/src/headers/symbology");
const radialPackets = require("nexrad-level-3-data/src/headers/radialpackets");
const sites = require("./sites.cjs");

const PORT = Number(process.env.CODEBLACK_RADAR_PORT || 8787);
const LEVEL2_BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com";
const LEVEL2_CHUNKS_BUCKET = "https://unidata-nexrad-level2-chunks.s3.amazonaws.com";
const LEVEL3_BUCKET = "https://unidata-nexrad-level3.s3.amazonaws.com";
const VERSION = "0.1.0";
const PRODUCTS = ["REF", "VEL", "SRV", "CC", "ET"];
const LEVEL2_PRODUCTS = new Set(["REF", "VEL", "SRV", "CC"]);
const PRODUCT_TO_ACCESSOR = {
  REF: "getHighresReflectivity",
  VEL: "getHighresVelocity",
  CC: "getHighresCorrelationCoefficient",
};
const ET_CODES = ["EET", "NET"];
const FRAME_LIMIT = 12;
const SITE_LIMIT = 3;
const TILE_SIZE = 256;
const CACHE_TTL_MS = 3 * 60_000;
const STALE_MS = 18 * 60_000;
const DELAYED_MS = 8 * 60_000;

let selectedSite = process.env.CODEBLACK_RADAR_SITE || "AUTO";
let selectedProduct = "REF";
let selectedTilt = 1;
let latestError = "";
let stormMotion = null;
const frames = new Map();
const tiles = new Map();
const siteUse = new Map();

function send(res, status, body, type = "application/json") {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": type === "application/json" ? "no-store" : "public, max-age=120",
  });
  res.end(data);
}

function jsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
    });
  });
}

function distanceMiles(a, b) {
  const r = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function bearingDeg(from, to) {
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const dLon = (to.lon - from.lon) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function tileToLonLat(z, x, y, px, py) {
  const n = 2 ** z;
  const lon = ((x + px / TILE_SIZE) / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / TILE_SIZE) / n)));
  return { lat: latRad * 180 / Math.PI, lon };
}

function sourceFreshness(ts, cached = false) {
  if (!ts) return "OFFLINE";
  const age = Date.now() - ts;
  if (cached) return "CACHED";
  if (age <= DELAYED_MS) return "LIVE";
  if (age <= STALE_MS) return "DELAYED";
  return "STALE";
}

function frameId(site, product, tilt, key, motion = "") {
  return crypto.createHash("sha1").update(`${site}:${product}:${tilt}:${key}:${motion}`).digest("hex").slice(0, 16);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

async function listS3(prefix, bucket = LEVEL2_BUCKET) {
  const xml = await fetchText(`${bucket}/?list-type=2&prefix=${encodeURIComponent(prefix)}`);
  return [...xml.matchAll(/<Key>(.*?)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

function level3DatePrefixes(site3, code) {
  return [0, 1, 2].map((daysBack) => {
    const date = new Date(Date.now() - daysBack * 86400_000);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    return `${site3}_${code}_${yyyy}_${mm}_${dd}`;
  });
}

function latestLevel2Prefix(site, date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${site}/`;
}

async function latestLevel2Key(site) {
  const dates = [new Date(), new Date(Date.now() - 24 * 3600_000)];
  for (const date of dates) {
    const keys = (await listS3(latestLevel2Prefix(site, date)))
      .filter((key) => !key.endsWith("_MDM") && /V0[368]$|V06$|V08$/.test(key))
      .sort();
    if (keys.length) return keys.at(-1);
  }
  return "";
}

function volumeTimeFromHeader(radar) {
  const base = Date.UTC(1970, 0, 1) + ((radar.header?.modified_julian_date ?? 0) - 1) * 86400_000;
  return base + (radar.header?.milliseconds ?? 0);
}

function getMoment(radar, product) {
  if (product === "SRV") {
    const velocity = radar.getHighresVelocity();
    const azimuth = radar.getAzimuth();
    return deriveSrv(velocity, azimuth);
  }
  return radar[PRODUCT_TO_ACCESSOR[product]]();
}

function deriveSrv(velocity, azimuths) {
  if (!stormMotion) throw new Error("SRV UNAVAILABLE - SET STORM MOTION");
  return velocity.map((radial, index) => {
    if (!radial) return radial;
    const radarBearing = Number(azimuths[index] ?? 0);
    const projection = stormMotion.speedKnots * Math.cos((stormMotion.directionDegrees - radarBearing) * Math.PI / 180);
    return {
      ...radial,
      name: "SRV",
      moment_data: radial.moment_data.map((value) => value == null ? null : value - projection),
    };
  });
}

function palette(product, value) {
  if (value == null || Number.isNaN(value)) return [0, 0, 0, 0];
  if (product === "REF") {
    const stops = [
      [-10, [0, 0, 0, 0]], [5, [42, 92, 120, 85]], [20, [23, 170, 80, 130]], [35, [235, 210, 33, 170]],
      [45, [255, 122, 20, 200]], [55, [230, 36, 45, 225]], [65, [205, 65, 210, 235]], [80, [255, 255, 255, 245]],
    ];
    return interpolateStops(stops, value);
  }
  if (product === "CC") {
    const v = Math.max(0, Math.min(1.05, value));
    if (v > 0.96) return [210, 220, 225, 105];
    if (v > 0.9) return [92, 190, 245, 160];
    if (v > 0.8) return [35, 210, 115, 190];
    if (v > 0.65) return [245, 210, 60, 210];
    return [230, 50, 55, 225];
  }
  if (product === "ET") {
    return interpolateStops([[0, [0, 0, 0, 0]], [10, [40, 120, 220, 120]], [30, [50, 220, 120, 180]], [45, [245, 210, 55, 220]], [60, [230, 45, 55, 235]]], value);
  }
  const v = Math.max(-80, Math.min(80, value));
  if (Math.abs(v) < 3) return [30, 30, 30, 50];
  if (v < 0) return interpolateStops([[-80, [30, 0, 120, 235]], [-45, [35, 80, 235, 225]], [-15, [50, 220, 255, 180]], [0, [0, 0, 0, 0]]], v);
  return interpolateStops([[0, [0, 0, 0, 0]], [15, [255, 230, 80, 180]], [45, [255, 95, 30, 225]], [80, [170, 0, 0, 235]]], v);
}

function interpolateStops(stops, value) {
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const t = Math.max(0, Math.min(1, (value - v0) / (v1 - v0 || 1)));
      return c0.map((c, idx) => Math.round(c + (c1[idx] - c) * t));
    }
  }
  return stops.at(-1)[1];
}

async function ensureLevel2Frame(siteId, product, tilt = 1) {
  const site = sites.find((item) => item.id === siteId);
  if (!site) throw new Error(`Unknown radar site ${siteId}`);
  if (!LEVEL2_PRODUCTS.has(product)) throw new Error(`${product} is not Level II`);
  if (product === "SRV" && !stormMotion) throw new Error("SRV UNAVAILABLE - SET STORM MOTION");

  const key = await latestLevel2Key(site.id);
  if (!key) throw new Error(`No Level II volume found for ${site.id}`);
  const id = frameId(site.id, product, tilt, key, product === "SRV" ? JSON.stringify(stormMotion) : "");
  const existing = frames.get(id);
  if (existing && Date.now() - existing.processedAt < CACHE_TTL_MS) return existing;

  const started = Date.now();
  const raw = await fetchBuffer(`${LEVEL2_BUCKET}/${key}`);
  const checksum = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 12);
  const radar = new Level2Radar(raw, { logger: false });
  const elevations = radar.listElevations();
  const chosenTilt = elevations.includes(Number(tilt)) ? Number(tilt) : elevations[0];
  radar.setElevation(chosenTilt);
  const data = getMoment(radar, product);
  const azimuths = radar.getAzimuth();
  const headers = radar.getHeader();
  const firstHeader = Array.isArray(headers) ? headers[0] : headers;
  const volumeTime = volumeTimeFromHeader(radar);
  const frame = {
    id,
    site,
    product,
    sourceLevel: "LEVEL II",
    sourceBucket: "unidata-nexrad-level2",
    sourceChunkBucket: "unidata-nexrad-level2-chunks",
    sourceNotification: "arn:aws:sns:us-east-1:684042711724:NewNEXRADLevel2ObjectFilterable",
    key,
    checksum,
    tilt: chosenTilt,
    elevationAngle: firstHeader?.elevation_angle ?? null,
    availableTilts: elevations,
    time: volumeTime,
    processedAt: Date.now(),
    processingDurationMs: Date.now() - started,
    vcp: radar.vcp?.record?.pattern_number ?? firstHeader?.volume?.volume_coverage_pattern ?? null,
    nyquistVelocity: firstHeader?.radial?.nyquist_velocity ?? null,
    quality: radar.isTruncated ? "INCOMPLETE" : radar.hasGaps ? "GAPS" : "OK",
    data,
    azimuths,
  };
  cacheFrame(frame);
  return frame;
}

async function ensureEtFrame(siteId) {
  const site = sites.find((item) => item.id === siteId);
  if (!site) throw new Error(`Unknown radar site ${siteId}`);
  const site3 = site.id.replace(/^K/, "");
  for (const code of ET_CODES) {
    const keys = [];
    for (const prefix of level3DatePrefixes(site3, code)) keys.push(...await listS3(prefix, LEVEL3_BUCKET));
    keys.sort();
    const key = keys.at(-1);
    if (!key) continue;
    const id = frameId(site.id, "ET", "level3", key);
    const existing = frames.get(id);
    if (existing) return existing;
    const raw = await fetchBuffer(`${LEVEL3_BUCKET}/${key}`);
    let parsed;
    try {
      parsed = parseLevel3(raw, { logger: false });
    } catch {
      parsed = parseOfficialEet(raw);
    }
    const packet = parsed.radialPackets?.[0];
    const radials = packet?.radials ?? [];
    const data = radials.map((radial) => ({
      name: "ET",
      first_gate: packet.firstBin * packet.rangeScale,
      gate_size: packet.rangeScale,
      gate_count: packet.numberBins,
      moment_data: radial.bins,
    }));
    const azimuths = radials.map((radial) => (radial.startAngle + radial.angleDelta / 2 + 360) % 360);
    const productTime = parsed.productDescription?.productDate ? level3ProductTime(parsed.productDescription.productDate, parsed.productDescription.productTime) : Date.now();
    const frame = {
      id,
      site,
      product: "ET",
      sourceLevel: "LEVEL III",
      sourceBucket: "unidata-nexrad-level3",
      key,
      checksum: crypto.createHash("sha1").update(raw).digest("hex").slice(0, 12),
      tilt: null,
      elevationAngle: null,
      availableTilts: [],
      time: productTime,
      processedAt: Date.now(),
      processingDurationMs: 0,
      vcp: null,
      nyquistVelocity: null,
      quality: data.length ? "OK" : "METADATA_ONLY",
      data,
      azimuths,
      parsed,
    };
    cacheFrame(frame);
    return frame;
  }
  throw new Error("ET UNAVAILABLE - official Level III ET product not found/renderable");
}

function parseOfficialEet(raw) {
  const product = {
    code: 135,
    abbreviation: ["EET"],
    description: "Enhanced Echo Tops",
    productDescription: {
      halfwords30_53(data) {
        const raf = new RandomAccessFile(data);
        return {
          plot: { minimumDataValue: 0, dataIncrement: 5, dataLevels: 16 },
          dependent30_46: raf.read(34),
          compressionMethod: raf.readShort(),
          uncompressedProductSize: (raf.readUShort() << 16) + raf.readUShort(),
          dependent51_53: raf.read(6),
        };
      },
    },
  };
  const raf = new RandomAccessFile(raw);
  const result = {};
  result.textHeader = textHeader(raf);
  const textHeaderLength = raf.getPos();
  if (result.textHeader.type !== "EET") throw new Error(`Unsupported ET product type: ${result.textHeader.type}`);
  result.messageHeader = messageHeader(raf);
  result.productDescription = productDescription(raf, product);
  let decompressed = raf;
  if (result.productDescription.compressionMethod > 0) {
    const rafPos = raf.getPos();
    const compressed = raf.read(raf.getLength() - raf.getPos());
    const data = bzip.decode(compressed);
    raf.seek(0);
    decompressed = new RandomAccessFile(Buffer.concat([raf.read(rafPos), data]));
    decompressed.seek(rafPos);
  }
  const offsetSymbologyBytes = textHeaderLength + result.productDescription.offsetSymbology * 2;
  decompressed.seek(offsetSymbologyBytes);
  result.symbology = symbologyHeader(decompressed);
  result.radialPackets = radialPackets(decompressed, result.productDescription, result.symbology.numberLayers, { logger: false });
  return result;
}

function level3ProductTime(julianDate, seconds) {
  return Date.UTC(1970, 0, 1) + (julianDate - 1) * 86400_000 + seconds * 1000;
}

function cacheFrame(frame) {
  frames.set(frame.id, frame);
  siteUse.set(frame.site.id, Date.now());
  const grouped = [...frames.values()].filter((item) => item.site.id === frame.site.id && item.product === frame.product && item.tilt === frame.tilt).sort((a, b) => b.processedAt - a.processedAt);
  grouped.slice(FRAME_LIMIT).forEach((item) => frames.delete(item.id));
  const oldSites = [...siteUse.entries()].sort((a, b) => b[1] - a[1]).slice(SITE_LIMIT).map(([site]) => site);
  for (const item of [...frames.values()]) if (!oldSites.includes(item.site.id)) frames.delete(item.id);
}

function renderTile(frame, z, x, y) {
  const tileKey = `${frame.id}/${z}/${x}/${y}`;
  if (tiles.has(tileKey)) return tiles.get(tileKey);
  const png = new PNG({ width: TILE_SIZE, height: TILE_SIZE });
  if (!frame.data) {
    const buf = PNG.sync.write(png);
    tiles.set(tileKey, buf);
    return buf;
  }
  const azimuths = frame.azimuths;
  const radials = frame.data;
  for (let py = 0; py < TILE_SIZE; py += 1) {
    for (let px = 0; px < TILE_SIZE; px += 1) {
      const pos = tileToLonLat(z, x, y, px, py);
      const distMi = distanceMiles(frame.site, pos);
      if (distMi > 160) continue;
      const bearing = bearingDeg(frame.site, pos);
      let best = 0;
      let bestDiff = 999;
      for (let i = 0; i < azimuths.length; i += 1) {
        const diff = Math.abs((((azimuths[i] - bearing + 540) % 360) - 180));
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      if (bestDiff > 1.4) continue;
      const radial = radials[best];
      if (!radial) continue;
      const rangeKm = distMi * 1.60934;
      const gate = Math.round((rangeKm - radial.first_gate) / radial.gate_size);
      const value = radial.moment_data?.[gate];
      const color = palette(frame.product, value);
      const idx = (py * TILE_SIZE + px) * 4;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }
  const buf = PNG.sync.write(png);
  tiles.set(tileKey, buf);
  if (tiles.size > 500) tiles.delete(tiles.keys().next().value);
  return buf;
}

async function ensureFrame(siteId, product, tilt) {
  if (product === "ET") return ensureEtFrame(siteId);
  return ensureLevel2Frame(siteId, product, tilt);
}

function metadata(frame) {
  return {
    frameId: frame.id,
    site: frame.site,
    product: frame.product,
    sourceLevel: frame.sourceLevel,
    sourceBucket: frame.sourceBucket,
    sourceChunkBucket: frame.sourceChunkBucket,
    sourceNotification: frame.sourceNotification,
    tilt: frame.tilt,
    availableTilts: frame.availableTilts,
    elevationAngle: frame.elevationAngle,
    time: new Date(frame.time).toISOString(),
    ageSeconds: Math.max(0, Math.round((Date.now() - frame.time) / 1000)),
    freshness: sourceFreshness(frame.time),
    vcp: frame.vcp,
    nyquistVelocity: frame.nyquistVelocity,
    quality: frame.quality,
    checksum: frame.checksum,
    processingDurationMs: frame.processingDurationMs,
    legend: legend(frame.product),
  };
}

function legend(product) {
  if (product === "REF") return { units: "dBZ", stops: [-10, 5, 20, 35, 45, 55, 65, 80] };
  if (product === "CC") return { units: "rho-hv", stops: [0.65, 0.8, 0.9, 0.96, 1.05] };
  if (product === "ET") return { units: "kft", stops: [10, 20, 30, 45, 60] };
  return { units: "kt", stops: [-80, -45, -15, 0, 15, 45, 80] };
}

function currentSiteForUrl(url) {
  return url.searchParams.get("site") || (selectedSite === "AUTO" ? "KSRX" : selectedSite);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/v1/radar/health") return send(res, 200, { ok: true, backend: "Code Black Radar Worker", version: VERSION });
    if (url.pathname === "/api/v1/radar/products") return send(res, 200, PRODUCTS.map((id) => ({ id, level: id === "ET" ? "LEVEL III" : "LEVEL II", label: { REF: "Base Reflectivity", VEL: "Base Velocity", SRV: "Storm-Relative Velocity", CC: "Correlation Coefficient", ET: "Echo Tops" }[id] })));
    if (url.pathname === "/api/v1/radar/sites") return send(res, 200, sites);
    if (url.pathname === "/api/v1/radar/sites/nearest") {
      const pos = { lat: Number(url.searchParams.get("lat")), lon: Number(url.searchParams.get("lon")) };
      const ranked = sites.map((site) => ({ ...site, distanceMi: distanceMiles(pos, site) })).sort((a, b) => a.distanceMi - b.distanceMi);
      return send(res, 200, ranked.slice(0, 8));
    }
    if (url.pathname === "/api/v1/radar/status") {
      const site = currentSiteForUrl(url);
      const product = url.searchParams.get("product") || selectedProduct;
      let frame = null;
      try { frame = await ensureFrame(site, product, Number(url.searchParams.get("tilt") || selectedTilt)); latestError = ""; } catch (error) { latestError = error.message; }
      const matchingFrameCount = [...frames.values()].filter((item) => item.site.id === site && item.product === product).length;
      return send(res, 200, {
        backendState: frame ? "READY" : "DEGRADED",
        backendVersion: VERSION,
        selectedSite: site,
        siteMode: selectedSite === "AUTO" ? "AUTO" : "MANUAL",
        availableProducts: PRODUCTS,
        selectedProduct: product,
        sourceLevel: frame?.sourceLevel ?? (product === "ET" ? "LEVEL III" : "LEVEL II"),
        selectedTilt: frame?.tilt ?? selectedTilt,
        availableTilts: frame?.availableTilts ?? [],
        currentFrameId: frame?.id ?? null,
        frameTime: frame ? new Date(frame.time).toISOString() : null,
        dataAgeSeconds: frame ? Math.round((Date.now() - frame.time) / 1000) : null,
        frameCount: frame ? Math.max(1, matchingFrameCount) : matchingFrameCount,
        cacheState: frame || frames.size ? "AVAILABLE" : "EMPTY",
        processingState: frame ? "IDLE" : "ERROR",
        latestError,
        stormMotion,
        reconnectState: latestError ? "BACKOFF" : "CONNECTED",
      });
    }
    if (url.pathname === "/api/v1/radar/frames") {
      const site = currentSiteForUrl(url);
      const product = url.searchParams.get("product") || selectedProduct;
      const limit = Number(url.searchParams.get("limit") || 6);
      const frame = await ensureFrame(site, product, Number(url.searchParams.get("tilt") || selectedTilt));
      const list = [...frames.values()].filter((item) => item.site.id === site && item.product === product).sort((a, b) => b.time - a.time).slice(0, limit);
      if (!list.find((item) => item.id === frame.id)) list.unshift(frame);
      return send(res, 200, list.map(metadata));
    }
    const metaMatch = url.pathname.match(/^\/api\/v1\/radar\/frame\/([^/]+)\/metadata$/);
    if (metaMatch) {
      const frame = frames.get(metaMatch[1]);
      return frame ? send(res, 200, metadata(frame)) : send(res, 404, { error: "frame not found" });
    }
    const tileMatch = url.pathname.match(/^\/api\/v1\/radar\/tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (tileMatch) {
      const frame = frames.get(tileMatch[1]);
      if (!frame) return send(res, 404, { error: "frame not found" });
      return send(res, 200, renderTile(frame, Number(tileMatch[2]), Number(tileMatch[3]), Number(tileMatch[4])), "image/png");
    }
    if (url.pathname === "/api/v1/radar/selection" && req.method === "POST") {
      const body = await jsonBody(req);
      if (body.site) selectedSite = String(body.site);
      if (PRODUCTS.includes(body.product)) selectedProduct = body.product;
      if (body.tilt) selectedTilt = Number(body.tilt);
      return send(res, 200, { selectedSite, selectedProduct, selectedTilt });
    }
    if (url.pathname === "/api/v1/radar/storm-motion" && req.method === "POST") {
      const body = await jsonBody(req);
      const directionDegrees = Number(body.directionDegrees);
      const speedKnots = Number(body.speedKnots);
      if (!Number.isFinite(directionDegrees) || !Number.isFinite(speedKnots)) return send(res, 400, { error: "directionDegrees and speedKnots are required" });
      stormMotion = { directionDegrees: ((directionDegrees % 360) + 360) % 360, speedKnots, source: body.source || "MANUAL", updatedAt: new Date().toISOString() };
      return send(res, 200, stormMotion);
    }
    return send(res, 404, { error: "not found" });
  } catch (error) {
    latestError = error.message;
    return send(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Code Black Radar Worker listening on http://0.0.0.0:${PORT}`);
  console.log(`Level II archive: ${LEVEL2_BUCKET}`);
  console.log(`Level II chunks: ${LEVEL2_CHUNKS_BUCKET}`);
  console.log(`Level III archive: ${LEVEL3_BUCKET}`);
});
