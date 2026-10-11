"use strict";

const { selectChaseRadarSites } = require("./chaseSelection.cjs");
function epochMs(value) { if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value; if (typeof value === "string") { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; } return null; }
function normalizeFabricChasers(snapshot) {
  return (Array.isArray(snapshot?.units) ? snapshot.units : []).filter((unit) => ["lead-chase-platform", "chase-platform"].includes(unit?.role)).map((unit) => {
    const p = unit.location || {}; return { id: String(unit.unit_id || ""), health: String(unit.overall_health || "UNKNOWN"), location: { lat: Number(p.lat ?? p.latitude), lon: Number(p.lon ?? p.longitude), observedAtMs: epochMs(p.observed_at ?? p.observedAt ?? p.timestamp ?? unit.last_seen) } };
  }).filter((unit) => unit.id);
}
class ChaseRadarController {
  constructor({ radarSites, nowMs = () => Date.now() }) { this.radarSites = radarSites; this.nowMs = nowMs; }
  observeFabric(snapshot) { return selectChaseRadarSites(normalizeFabricChasers(snapshot), this.radarSites, { nowMs: this.nowMs() }); }
}
module.exports = { ChaseRadarController, normalizeFabricChasers };
