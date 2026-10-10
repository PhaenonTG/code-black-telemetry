"use strict";

// Pure policy module. It deliberately accepts only a normalized, trusted chase-unit snapshot;
// fetching Fabric and exposing locations are separate authorization concerns.
const DEFAULTS = Object.freeze({
  locationMaxAgeMs: 120_000,
  maxPrimarySites: 2,
  maxSecondarySites: 1,
  acceptedHealth: new Set(["LIVE", "DEGRADED"]),
});

function distanceMiles(a, b) {
  const r = 3958.8;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function finiteLocation(value) {
  return value && Number.isFinite(value.lat) && Number.isFinite(value.lon)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180;
}

function selectChaseRadarSites(units, radarSites, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const now = options.nowMs ?? Date.now();
  const locations = [];
  const skipped = [];
  for (const unit of units || []) {
    const location = unit.location;
    const observedAt = Number(location?.observedAtMs);
    const ageMs = Number.isFinite(observedAt) ? Math.max(0, now - observedAt) : null;
    if (!finiteLocation(location)) { skipped.push({ unitId: unit.id, reason: "LOCATION_UNAVAILABLE" }); continue; }
    if (!cfg.acceptedHealth.has(unit.health)) { skipped.push({ unitId: unit.id, reason: "UNIT_NOT_ACTIVE" }); continue; }
    if (ageMs === null || ageMs > cfg.locationMaxAgeMs) { skipped.push({ unitId: unit.id, reason: "LOCATION_STALE", ageMs }); continue; }
    locations.push({ ...unit, location, locationAgeMs: ageMs });
  }

  const primaryBySite = new Map();
  const secondaries = [];
  for (const unit of locations.sort((a, b) => a.id.localeCompare(b.id))) {
    const ranked = (radarSites || []).map((site) => ({ site, distanceMi: distanceMiles(unit.location, site) }))
      .sort((a, b) => a.distanceMi - b.distanceMi || a.site.id.localeCompare(b.site.id));
    if (ranked[0]) {
      const existing = primaryBySite.get(ranked[0].site.id) || { site: ranked[0].site, distanceMi: ranked[0].distanceMi, unitIds: [] };
      existing.distanceMi = Math.min(existing.distanceMi, ranked[0].distanceMi);
      existing.unitIds.push(unit.id);
      primaryBySite.set(ranked[0].site.id, existing);
    }
    if (ranked[1]) secondaries.push({ ...ranked[1], unitId: unit.id });
  }

  const primary = [...primaryBySite.values()].sort((a, b) => a.distanceMi - b.distanceMi || a.site.id.localeCompare(b.site.id))
    .slice(0, cfg.maxPrimarySites);
  const primaryIds = new Set(primary.map((entry) => entry.site.id));
  const secondary = secondaries.filter((entry) => !primaryIds.has(entry.site.id))
    .sort((a, b) => a.distanceMi - b.distanceMi || a.site.id.localeCompare(b.site.id))
    .slice(0, cfg.maxSecondarySites);

  return {
    policy: { locationMaxAgeMs: cfg.locationMaxAgeMs, maxPrimarySites: cfg.maxPrimarySites, maxSecondarySites: cfg.maxSecondarySites },
    eligibleChasers: locations.map(({ id, locationAgeMs }) => ({ id, locationAgeMs })),
    skippedChasers: skipped,
    primary: primary.map((entry) => ({ siteId: entry.site.id, distanceMi: Number(entry.distanceMi.toFixed(1)), unitIds: entry.unitIds })),
    secondary: secondary.map((entry) => ({ siteId: entry.site.id, distanceMi: Number(entry.distanceMi.toFixed(1)), unitId: entry.unitId })),
  };
}

module.exports = { distanceMiles, selectChaseRadarSites };
