"use strict";

const HOLD_MS = 24 * 60 * 60 * 1000;
const FALLBACKS = Object.freeze({
  "cbwx-unit-striker": { id: "cbwx-unit-striker", label: "SPENCER", lat: 36.460583, lon: -94.113000, source: "DEFAULT_PEA_RIDGE" },
  "cbwx-unit-tessa": { id: "cbwx-unit-tessa", label: "NICK", lat: 39.0473, lon: -95.6752, source: "DEFAULT_TOPEKA" },
});

function epochMs(value) { if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value; const parsed = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : null; }
function valid(loc) { return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180; }
function locationOf(unit) { const p = unit?.location || {}; return { lat: Number(p.lat ?? p.latitude), lon: Number(p.lon ?? p.longitude), observedAtMs: epochMs(p.observed_at ?? p.observedAt ?? p.timestamp ?? unit?.last_seen) }; }

function resolveChaserLocations(snapshot, stored = {}, nowMs = Date.now()) {
  const incoming = new Map((Array.isArray(snapshot?.units) ? snapshot.units : []).map((unit) => [String(unit?.unit_id || ""), unit]));
  const next = {}, units = [], sources = [];
  for (const [id, fallback] of Object.entries(FALLBACKS)) {
    const unit = incoming.get(id), live = locationOf(unit);
    const liveUsable = valid(live) && live.observedAtMs != null && nowMs - live.observedAtMs <= HOLD_MS;
    if (liveUsable) next[id] = { lat: live.lat, lon: live.lon, observedAtMs: live.observedAtMs };
    const held = next[id] || stored[id];
    const heldUsable = valid(held) && Number.isFinite(held.observedAtMs) && nowMs - held.observedAtMs <= HOLD_MS;
    const source = liveUsable && ["LIVE", "DEGRADED"].includes(String(unit?.overall_health || "")) ? "LIVE_FABRIC" : heldUsable ? "LAST_KNOWN" : fallback.source;
    const loc = source === fallback.source ? { lat: fallback.lat, lon: fallback.lon, observedAtMs: nowMs } : held;
    if (heldUsable && !next[id]) next[id] = held;
    units.push({ id, health: "LIVE", location: loc });
    sources.push({ unit_id: id, source, age_s: source === fallback.source ? null : Math.max(0, Math.round((nowMs - loc.observedAtMs) / 1000)) });
  }
  return { units, next, sources };
}
module.exports = { HOLD_MS, FALLBACKS, resolveChaserLocations };
