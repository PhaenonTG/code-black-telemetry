"use strict";

const DEFAULTS = Object.freeze({ locationMaxAgeMs: 120_000, maxPrimarySites: 2, maxSecondarySites: 1, acceptedHealth: new Set(["LIVE", "DEGRADED"]) });

function distanceMiles(a, b) {
  const r = 3958.8, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function selectChaseRadarSites(units, radarSites, options = {}) {
  const cfg = { ...DEFAULTS, ...options }, now = options.nowMs ?? Date.now(), eligible = [], skipped = [];
  for (const unit of units || []) {
    const loc = unit.location, observedAt = Number(loc?.observedAtMs), ageMs = Number.isFinite(observedAt) ? Math.max(0, now - observedAt) : null;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon) || Math.abs(loc.lat) > 90 || Math.abs(loc.lon) > 180) { skipped.push({ unitId: unit.id, reason: "LOCATION_UNAVAILABLE" }); continue; }
    if (!cfg.acceptedHealth.has(unit.health)) { skipped.push({ unitId: unit.id, reason: "UNIT_NOT_ACTIVE" }); continue; }
    if (ageMs === null || ageMs > cfg.locationMaxAgeMs) { skipped.push({ unitId: unit.id, reason: "LOCATION_STALE" }); continue; }
    eligible.push({ ...unit, locationAgeMs: ageMs });
  }
  const primaryBySite = new Map(), secondaries = [];
  for (const unit of eligible.sort((a, b) => a.id.localeCompare(b.id))) {
    const ranked = (radarSites || []).map((site) => ({ site, distanceMi: distanceMiles(unit.location, site) })).sort((a, b) => a.distanceMi - b.distanceMi || a.site.id.localeCompare(b.site.id));
    if (ranked[0]) { const prior = primaryBySite.get(ranked[0].site.id) || { site: ranked[0].site, distanceMi: ranked[0].distanceMi, unitIds: [] }; prior.distanceMi = Math.min(prior.distanceMi, ranked[0].distanceMi); prior.unitIds.push(unit.id); primaryBySite.set(ranked[0].site.id, prior); }
    if (ranked[1]) secondaries.push({ ...ranked[1], unitId: unit.id });
  }
  const primary = [...primaryBySite.values()].sort((a, b) => a.distanceMi - b.distanceMi || a.site.id.localeCompare(b.site.id)).slice(0, cfg.maxPrimarySites);
  const primaryIds = new Set(primary.map((entry) => entry.site.id));
  const secondary = secondaries.filter((entry) => !primaryIds.has(entry.site.id)).sort((a, b) => a.distanceMi - b.distanceMi || a.site.id.localeCompare(b.site.id)).slice(0, cfg.maxSecondarySites);
  return { eligibleChasers: eligible.map((item) => ({ id: item.id, locationAgeMs: item.locationAgeMs })), skippedChasers: skipped,
    primary: primary.map((item) => ({ siteId: item.site.id, distanceMi: Number(item.distanceMi.toFixed(1)) })), secondary: secondary.map((item) => ({ siteId: item.site.id, distanceMi: Number(item.distanceMi.toFixed(1)) })) };
}

module.exports = { selectChaseRadarSites };
