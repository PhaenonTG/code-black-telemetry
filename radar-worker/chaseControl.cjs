"use strict";

const { selectChaseRadarSites } = require("./chaseSelection.cjs");

function epochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
  return null;
}

// Fabric is authoritative only when it supplies an explicit unit location. This adapter does
// not fall back to display/map state or infer a chaser's position from its nearest radar.
function normalizeFabricChasers(snapshot) {
  const units = Array.isArray(snapshot?.units) ? snapshot.units : [];
  return units.filter((unit) => ["lead-chase-platform", "chase-platform"].includes(unit?.role))
    .map((unit) => {
      const p = unit.location || {};
      return {
        id: String(unit.unit_id || ""),
        health: String(unit.overall_health || "UNKNOWN"),
        location: {
          lat: Number(p.lat ?? p.latitude), lon: Number(p.lon ?? p.longitude),
          observedAtMs: epochMs(p.observed_at ?? p.observedAt ?? p.timestamp ?? unit.last_seen),
        },
      };
    }).filter((unit) => unit.id);
}

class ChaseRadarController {
  constructor({ radarSites, nowMs = () => Date.now(), policy = {} }) {
    this.radarSites = radarSites;
    this.nowMs = nowMs;
    this.policy = policy;
    this.last = { state: "NOT_CONFIGURED", reason: "Fabric snapshot not observed", primary: [], secondary: [] };
  }

  observeFabric(snapshot) {
    const selected = selectChaseRadarSites(normalizeFabricChasers(snapshot), this.radarSites, { ...this.policy, nowMs: this.nowMs() });
    this.last = {
      state: selected.primary.length ? "READY" : "DEGRADED",
      reason: selected.primary.length ? "Primary radar sites selected from fresh Fabric locations" : "No fresh active chase-unit locations",
      observedAt: new Date(this.nowMs()).toISOString(),
      ...selected,
    };
    return this.status();
  }

  status() {
    // No raw coordinates, auth values, or Fabric payload pass through this boundary.
    return JSON.parse(JSON.stringify(this.last));
  }
}

module.exports = { epochMs, normalizeFabricChasers, ChaseRadarController };
