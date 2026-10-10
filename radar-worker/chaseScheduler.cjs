"use strict";

// This orchestrates selection and prewarming without owning Fabric credentials, HTTP, or
// long-lived location state.  Production wires a trusted snapshot reader and a bounded
// `ensureFrame` adapter into this seam; tests use a local fake and never start the worker.
const VALID_MODES = new Set(["DISABLED", "OBSERVER", "ACTIVE"]);

function asMode(value) {
  const mode = String(value || "OBSERVER").toUpperCase();
  if (!VALID_MODES.has(mode)) throw new Error("mode must be DISABLED, OBSERVER, or ACTIVE");
  return mode;
}

function safeErrorCode(error) {
  const name = String(error?.name || "ERROR").replace(/[^A-Z0-9_]/gi, "_").toUpperCase();
  return `PREWARM_${name || "ERROR"}`;
}

function statusSite(entry) {
  return { site_id: entry.siteId, distance_km: Number((entry.distanceMi * 1.609344).toFixed(1)) };
}

class ChaseRadarScheduler {
  constructor({ controller, prewarm, nowMs = () => Date.now(), mode = "OBSERVER", product = "REF", tilt = 1 }) {
    if (!controller || typeof controller.observeFabric !== "function") throw new Error("controller is required");
    if (typeof prewarm !== "function") throw new Error("prewarm is required");
    this.controller = controller;
    this.prewarm = prewarm;
    this.nowMs = nowMs;
    this.mode = asMode(mode);
    this.product = product;
    this.tilt = tilt;
    this.last = this._initialStatus();
  }

  _initialStatus() {
    return {
      state: "NOT_CONFIGURED", mode: this.mode, reason: "Fabric snapshot not observed",
      fabric: { state: "UNKNOWN", snapshot_age_s: null, eligible_chasers: 0, skipped_chasers: 0 },
      selection: { primary: [], secondary: [] },
      work: { active_site: null, queued_sites: 0, last_success_at: null, last_error: null },
      capabilities: { closest_site_selection: "AVAILABLE", secondary_prewarm: "AVAILABLE", configuration_ui: "NOT_DEPLOYED" },
    };
  }

  setMode(mode) {
    this.mode = asMode(mode);
    this.last = { ...this.last, mode: this.mode };
    return this.status();
  }

  _selectedStatus(selected) {
    const ages = selected.eligibleChasers.map((item) => item.locationAgeMs).filter(Number.isFinite);
    return {
      state: selected.state,
      mode: this.mode,
      reason: selected.reason,
      fabric: { state: selected.primary.length ? "FRESH" : "DEGRADED", snapshot_age_s: ages.length ? Math.round(Math.max(...ages) / 1000) : null,
                eligible_chasers: selected.eligibleChasers.length, skipped_chasers: selected.skippedChasers.length },
      selection: { primary: selected.primary.map(statusSite), secondary: selected.secondary.map(statusSite) },
      work: { active_site: null, queued_sites: this.mode === "ACTIVE" ? selected.primary.length + selected.secondary.length : 0,
              last_success_at: this.last.work.last_success_at, last_error: null },
      capabilities: { closest_site_selection: "AVAILABLE", secondary_prewarm: "AVAILABLE", configuration_ui: "NOT_DEPLOYED" },
    };
  }

  async observe(snapshot) {
    const selected = this.controller.observeFabric(snapshot);
    this.last = this._selectedStatus(selected);
    if (this.mode !== "ACTIVE" || !selected.primary.length) return this.status();

    let primarySucceeded = true;
    const queue = [...selected.primary.map((entry) => ({ entry, priority: "PRIMARY" })), ...selected.secondary.map((entry) => ({ entry, priority: "SECONDARY" }))];
    for (const item of queue) {
      // Secondary coverage is intentionally opportunistic: never compete with a failed or
      // incomplete primary pass.  A later cycle can retry primary work first.
      if (item.priority === "SECONDARY" && !primarySucceeded) break;
      this.last.work.active_site = item.entry.siteId;
      this.last.work.queued_sites = Math.max(0, this.last.work.queued_sites - 1);
      try {
        await this.prewarm({ siteId: item.entry.siteId, product: this.product, tilt: this.tilt, priority: item.priority });
        this.last.work.last_success_at = new Date(this.nowMs()).toISOString();
      } catch (error) {
        primarySucceeded = item.priority !== "PRIMARY" && primarySucceeded;
        this.last.state = "DEGRADED";
        this.last.reason = "Radar prewarm did not complete";
        this.last.work.last_error = safeErrorCode(error);
      } finally {
        this.last.work.active_site = null;
      }
    }
    return this.status();
  }

  status() {
    // Protect callers from mutating internal state, and keep the public status free of locations.
    return JSON.parse(JSON.stringify(this.last));
  }
}

module.exports = { ChaseRadarScheduler, asMode, safeErrorCode };
