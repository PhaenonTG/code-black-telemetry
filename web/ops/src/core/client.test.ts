import { describe, expect, it } from "vitest";
import { normalizeStormIntelSnapshot } from "../../../../web/overlay/src/stormIntel/normalize";
import { coreConfigured, readOpsCoreConfig } from "./config";
import { normalizeFabricWsEvent } from "./client";
import { fabricStateFromSnapshot } from "./fabricSnapshot";

const productionPoint = {
  schema: "codeblack.storm-intel.snapshot",
  schema_version: "1.0.0",
  generated_at: "2026-09-06T19:12:19Z",
  context: {
    context_type: "SELECTED_TARGET",
    location: {
      available: true,
      latitude: 36.4537,
      longitude: -94.1152,
      resolved_from: "explicit_target",
      unit_id: null,
      unit_position_observed_at: null,
      unit_position_health_state: null,
      heading_deg: null,
      distance_miles: null,
      unavailable_reason: null,
    },
    requested_at: "2026-09-06T19:12:19Z",
  },
  provider_name: "hrrr_rap",
  simulation: false,
  metrics: [
    {
      key: "mlcape",
      label: "Mixed-Layer CAPE",
      value: 860,
      unit: "J/kg",
      source: {
        provider: "hrrr",
        product: "hrrr-sfc forecast (f01)",
        run_time: "2026-09-06T18:00:00Z",
        valid_time: "2026-09-06T19:00:00Z",
        formulation: null,
        forecast_hour: 1,
        data_class: "MODEL_FORECAST",
        resolved_latitude: 36.4513,
        resolved_longitude: -94.1196,
        grid_distance_km: 0.48,
      },
      retrieved_at: "2026-09-06T19:12:19Z",
      age_seconds: 739,
      freshness: "current",
      quality: null,
      availability: "available",
      unavailable_reason: null,
      trend: null,
      derivation: null,
    },
    {
      key: "bulk_shear_0_6km",
      label: "0-6 km Bulk Shear",
      value: null,
      unit: "kt",
      source: null,
      retrieved_at: null,
      age_seconds: null,
      freshness: "unavailable",
      quality: null,
      availability: "unavailable",
      unavailable_reason: "not exposed by provider",
      trend: null,
      derivation: null,
    },
  ],
  score: { available: false, value: null, label: "Score", algorithm_id: "disabled", algorithm_version: "0", inputs_used: [], unavailable_reason: null },
  canonical_units: {},
  available: true,
  unavailable_reason: null,
};

describe("Core transport helpers", () => {
  it("normalizes production Fabric snapshot events", () => {
    const event = normalizeFabricWsEvent(JSON.stringify({
      event_type: "fabric.snapshot",
      timestamp: "2026-09-06T19:12:20Z",
      payload: { schema: "codeblack.fabric.unit-state", schema_version: "1.0.0", generated_at: "2026-09-06T19:12:20Z", units: [], transports: {} },
    }));
    expect(event.eventType).toBe("fabric.snapshot");
    expect(fabricStateFromSnapshot(event.payload)?.units).toEqual([]);
  });

  it("rejects malformed Fabric WebSocket events", () => {
    expect(() => normalizeFabricWsEvent("{")).toThrow(/Malformed Fabric/);
    expect(() => normalizeFabricWsEvent(JSON.stringify({ timestamp: "x" }))).toThrow(/missing event_type/);
  });

  it("preserves production Storm Intel provenance and MODEL_FORECAST semantics", () => {
    const snapshot = normalizeStormIntelSnapshot(productionPoint);
    const metric = snapshot.metrics[0];
    expect(metric.dataClass).toBe("MODEL_FORECAST");
    expect(metric.source?.forecastHour).toBe(1);
    expect(metric.source?.resolvedLatitude).toBeCloseTo(36.4513);
    expect(metric.source?.gridDistanceKm).toBeCloseTo(0.48);
  });

  it("preserves MODEL_ANALYSIS when Core sends analysis-class provenance", () => {
    const body = structuredClone(productionPoint);
    const source = body.metrics[0].source;
    if (!source) throw new Error("test fixture missing metric source");
    source.data_class = "MODEL_ANALYSIS";
    source.forecast_hour = 0;
    source.valid_time = source.run_time;
    const snapshot = normalizeStormIntelSnapshot(body);
    expect(snapshot.metrics[0].dataClass).toBe("MODEL_ANALYSIS");
    expect(snapshot.metrics[0].source?.forecastHour).toBe(0);
  });

  it("keeps unavailable metrics unavailable instead of fabricating values", () => {
    const snapshot = normalizeStormIntelSnapshot(productionPoint);
    const shear = snapshot.metrics.find((metric) => metric.key === "bulk_shear_0_6km");
    expect(shear?.availability).toBe("unavailable");
    expect(shear?.value).toBeNull();
  });

  it("keeps simulation mode explicit and disconnected from live Core", () => {
    const config = readOpsCoreConfig({ VITE_OPS_DATA_MODE: "SIMULATION", VITE_CODEBLACK_CORE_BASE_URL: "http://127.0.0.1:18000" });
    expect(config.mode).toBe("SIMULATION");
    expect(coreConfigured(config)).toBe(false);
  });
});
