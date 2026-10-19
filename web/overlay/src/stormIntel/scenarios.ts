import type {
  HodographData,
  MetricKey,
  MetricSource,
  NormalizedMetric,
  PublicLocationInfo,
  SimulationScenario,
  StormIntelFreshness,
  StormIntelScore,
  WindProfileLevel,
} from "./types";
import { classifyDataClass } from "./dataClass";

const LABELS: Record<MetricKey, string> = {
  sbcape: "Surface-Based CAPE",
  mlcape: "Mixed-Layer CAPE",
  mucape: "Most-Unstable CAPE",
  sbcin: "Surface-Based CIN",
  mlcin: "Mixed-Layer CIN",
  mucin: "Most-Unstable CIN",
  surface_temperature: "Temperature",
  surface_dewpoint: "Dewpoint",
  relative_humidity: "Relative Humidity",
  lcl_height: "LCL Height",
  srh_0_1km: "0-1km SRH",
  srh_0_3km: "0-3km SRH",
  bulk_shear_0_6km: "0-6km Shear",
  lapse_rate_0_3km: "0-3km Lapse Rate",
  lapse_rate_700_500mb: "700-500mb Lapse Rate",
  significant_tornado_parameter: "Sig. Tornado Parameter",
  supercell_composite_parameter: "Supercell Composite",
};

const UNITS: Record<MetricKey, string> = {
  sbcape: "J/kg",
  mlcape: "J/kg",
  mucape: "J/kg",
  sbcin: "J/kg",
  mlcin: "J/kg",
  mucin: "J/kg",
  surface_temperature: "°F",
  surface_dewpoint: "°F",
  relative_humidity: "%",
  lcl_height: "m",
  srh_0_1km: "m²/s²",
  srh_0_3km: "m²/s²",
  bulk_shear_0_6km: "kt",
  lapse_rate_0_3km: "°C/km",
  lapse_rate_700_500mb: "°C/km",
  significant_tornado_parameter: "",
  supercell_composite_parameter: "",
};

const STP_FORMULATION = "SPC effective-layer Significant Tornado Parameter";
const SCP_FORMULATION = "SPC effective-layer Supercell Composite Parameter";

type RawValues = Partial<Record<MetricKey, number>>;

const SCENARIO_VALUES: Record<
  Exclude<SimulationScenario, "provider_failure" | "unavailable_unit_location">,
  RawValues
> = {
  low_end: {
    sbcape: 300,
    mlcape: 350,
    mucape: 450,
    sbcin: -120,
    mlcin: -90,
    mucin: -60,
    surface_temperature: 79,
    surface_dewpoint: 57,
    relative_humidity: 45,
    lcl_height: 1800,
    srh_0_1km: 60,
    srh_0_3km: 90,
    bulk_shear_0_6km: 24,
    lapse_rate_0_3km: 6.5,
    lapse_rate_700_500mb: 6.0,
    significant_tornado_parameter: 0.1,
    supercell_composite_parameter: 0.3,
  },
  severe_supercell: {
    sbcape: 2400,
    mlcape: 2200,
    mucape: 2600,
    sbcin: -25,
    mlcin: -15,
    mucin: -10,
    surface_temperature: 84,
    surface_dewpoint: 70,
    relative_humidity: 64,
    lcl_height: 900,
    srh_0_1km: 220,
    srh_0_3km: 320,
    bulk_shear_0_6km: 49,
    lapse_rate_0_3km: 8.0,
    lapse_rate_700_500mb: 7.2,
    significant_tornado_parameter: 3.5,
    supercell_composite_parameter: 6.8,
  },
  high_end_tornadic: {
    sbcape: 3400,
    mlcape: 3200,
    mucape: 3600,
    sbcin: -10,
    mlcin: -5,
    mucin: -5,
    surface_temperature: 86,
    surface_dewpoint: 73,
    relative_humidity: 68,
    lcl_height: 650,
    srh_0_1km: 350,
    srh_0_3km: 450,
    bulk_shear_0_6km: 58,
    lapse_rate_0_3km: 8.5,
    lapse_rate_700_500mb: 7.8,
    significant_tornado_parameter: 7.2,
    supercell_composite_parameter: 12.5,
  },
  strong_cap_high_instability: {
    sbcape: 4500,
    mlcape: 4200,
    mucape: 4800,
    sbcin: -180,
    mlcin: -150,
    mucin: -140,
    surface_temperature: 91,
    surface_dewpoint: 72,
    relative_humidity: 52,
    lcl_height: 1400,
    srh_0_1km: 90,
    srh_0_3km: 140,
    bulk_shear_0_6km: 29,
    lapse_rate_0_3km: 7.0,
    lapse_rate_700_500mb: 6.5,
    significant_tornado_parameter: 0.8,
    supercell_composite_parameter: 2.1,
  },
  stale_data: {
    sbcape: 2400,
    mlcape: 2200,
    mucape: 2600,
    sbcin: -25,
    mlcin: -15,
    mucin: -10,
    surface_temperature: 84,
    surface_dewpoint: 70,
    relative_humidity: 64,
    lcl_height: 900,
    srh_0_1km: 220,
    srh_0_3km: 320,
    bulk_shear_0_6km: 49,
    lapse_rate_0_3km: 8.0,
    lapse_rate_700_500mb: 7.2,
    significant_tornado_parameter: 3.5,
    supercell_composite_parameter: 6.8,
  },
  partial_data: {
    sbcape: 300,
    mlcape: 350,
    mucape: 450,
    sbcin: -120,
    mlcin: -90,
    surface_temperature: 79,
    surface_dewpoint: 57,
    relative_humidity: 45,
    lcl_height: 1800,
    srh_0_1km: 60,
    srh_0_3km: 90,
    bulk_shear_0_6km: 24,
    lapse_rate_0_3km: 6.5,
    lapse_rate_700_500mb: 6.0,
    significant_tornado_parameter: 0.1,
  },
};

const ALL_KEYS = Object.keys(LABELS) as MetricKey[];

function formulationFor(key: MetricKey): string | null {
  if (key === "significant_tornado_parameter") return STP_FORMULATION;
  if (key === "supercell_composite_parameter") return SCP_FORMULATION;
  return null;
}

export function buildMetrics(
  scenario: SimulationScenario,
  now: Date,
): { metrics: NormalizedMetric[]; source: MetricSource | null; freshness: StormIntelFreshness } {
  if (scenario === "provider_failure" || scenario === "unavailable_unit_location") {
    return {
      source: null,
      freshness: "unavailable",
      metrics: ALL_KEYS.map((key) => ({
        key,
        label: LABELS[key],
        value: null,
        unit: null,
        source: null,
        retrievedAt: null,
        ageSeconds: null,
        freshness: "unavailable",
        quality: null,
        availability: "unavailable",
        unavailableReason:
          scenario === "provider_failure"
            ? "Simulated upstream provider failure."
            : "No current position is available for this unit.",
        trend: null,
        derivation: null,
        dataClass: null,
      })),
    };
  }

  const values = SCENARIO_VALUES[scenario];
  const isStale = scenario === "stale_data";
  const validTime = new Date(now.getTime() - (isStale ? 4 * 60 * 60 * 1000 : 6 * 60 * 1000));
  const runTime = new Date(validTime);
  runTime.setMinutes(0, 0, 0);
  const ageSeconds = Math.round((now.getTime() - validTime.getTime()) / 1000);
  const freshness: StormIntelFreshness =
    ageSeconds <= 90 * 60 ? "current" : ageSeconds <= 180 * 60 ? "aging" : "stale";

  const source: MetricSource = {
    provider: "simulation",
    product: `SIMULATED-${scenario}`,
    runTime: runTime.toISOString(),
    validTime: validTime.toISOString(),
    formulation: null,
    forecastHour: 0,
    dataClass: "MODEL_ANALYSIS",
    resolvedLatitude: null,
    resolvedLongitude: null,
    gridDistanceKm: 0,
  };

  const metrics = ALL_KEYS.map((key): NormalizedMetric => {
    const value = values[key];
    const metricSource = { ...source, formulation: formulationFor(key) };
    if (value === undefined) {
      return {
        key,
        label: LABELS[key],
        value: null,
        unit: null,
        source: metricSource,
        retrievedAt: now.toISOString(),
        ageSeconds,
        freshness,
        quality: null,
        availability: "unavailable",
        unavailableReason: `simulation did not provide ${LABELS[key]} at this point.`,
        trend: null,
        derivation: null,
        dataClass: classifyDataClass(metricSource),
      };
    }
    return {
      key,
      label: LABELS[key],
      value,
      unit: UNITS[key],
      source: metricSource,
      retrievedAt: now.toISOString(),
      ageSeconds,
      freshness,
      quality: "nominal",
      availability: "available",
      unavailableReason: null,
      trend: null,
      derivation: null,
      dataClass: classifyDataClass(metricSource),
    };
  });

  return { metrics, source, freshness };
}

export function scoreFromMetrics(metrics: NormalizedMetric[]): StormIntelScore {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const curves: Record<string, [number, number][]> = {
    mlcape: [
      [0, 0],
      [500, 2],
      [1500, 5],
      [2500, 7],
      [4000, 9],
      [6000, 10],
    ],
    bulk_shear_0_6km: [
      [0, 0],
      [19, 2],
      [29, 4],
      [39, 6],
      [49, 8],
      [58, 10],
    ],
    srh_0_1km: [
      [0, 0],
      [50, 2],
      [100, 4],
      [150, 6],
      [250, 8],
      [400, 10],
    ],
    significant_tornado_parameter: [
      [0, 0],
      [0.5, 2],
      [1, 4],
      [3, 6],
      [6, 8],
      [10, 10],
    ],
  };
  const weights: Record<string, number> = {
    mlcape: 0.3,
    bulk_shear_0_6km: 0.2,
    srh_0_1km: 0.2,
    significant_tornado_parameter: 0.3,
  };

  function piecewise(value: number, points: [number, number][]): number {
    if (value <= points[0][0]) return points[0][1];
    const last = points[points.length - 1];
    if (value >= last[0]) return last[1];
    for (let i = 0; i < points.length - 1; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      if (value >= x0 && value <= x1) {
        return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return last[1];
  }

  let weightedSum = 0;
  let weightTotal = 0;
  const inputsUsed: MetricKey[] = [];
  for (const key of Object.keys(weights) as MetricKey[]) {
    const metric = byKey.get(key);
    if (!metric || metric.value === null || metric.availability === "unavailable") continue;
    weightedSum += piecewise(metric.value, curves[key]) * weights[key];
    weightTotal += weights[key];
    inputsUsed.push(key);
  }

  if (weightTotal <= 0) {
    return {
      available: false,
      value: null,
      label: "Code Black Storm Environment Score (experimental, Code Black-derived)",
      algorithmId: "codeblack-storm-intel-score-prototype",
      algorithmVersion: "0.1.0-experimental",
      inputsUsed: [],
      unavailableReason: "No scoring inputs were available.",
    };
  }

  const value = Math.round((weightedSum / weightTotal) * 10) / 10;
  return {
    available: true,
    value: Math.max(0, Math.min(10, value)),
    label: "Code Black Storm Environment Score (experimental, Code Black-derived)",
    algorithmId: "codeblack-storm-intel-score-prototype",
    algorithmVersion: "0.1.0-experimental",
    inputsUsed,
    unavailableReason: null,
  };
}

const HODOGRAPH_PROFILES: Record<
  Exclude<SimulationScenario, "provider_failure" | "unavailable_unit_location">,
  WindProfileLevel[]
> = {
  low_end: [
    { heightKm: 0, band: "surface", speedKt: 8, directionDeg: 170 },
    { heightKm: 0.5, band: "low", speedKt: 14, directionDeg: 190 },
    { heightKm: 1, band: "low", speedKt: 18, directionDeg: 205 },
    { heightKm: 2, band: "mid", speedKt: 22, directionDeg: 220 },
    { heightKm: 3, band: "mid", speedKt: 26, directionDeg: 230 },
    { heightKm: 6, band: "upper", speedKt: 32, directionDeg: 245 },
    { heightKm: 9, band: "upper", speedKt: 38, directionDeg: 255 },
  ],
  severe_supercell: [
    { heightKm: 0, band: "surface", speedKt: 15, directionDeg: 160 },
    { heightKm: 0.5, band: "low", speedKt: 28, directionDeg: 185 },
    { heightKm: 1, band: "low", speedKt: 38, directionDeg: 205 },
    { heightKm: 2, band: "mid", speedKt: 46, directionDeg: 225 },
    { heightKm: 3, band: "mid", speedKt: 52, directionDeg: 240 },
    { heightKm: 6, band: "upper", speedKt: 64, directionDeg: 258 },
    { heightKm: 9, band: "upper", speedKt: 74, directionDeg: 268 },
  ],
  high_end_tornadic: [
    { heightKm: 0, band: "surface", speedKt: 18, directionDeg: 150 },
    { heightKm: 0.5, band: "low", speedKt: 34, directionDeg: 180 },
    { heightKm: 1, band: "low", speedKt: 46, directionDeg: 202 },
    { heightKm: 2, band: "mid", speedKt: 56, directionDeg: 224 },
    { heightKm: 3, band: "mid", speedKt: 63, directionDeg: 238 },
    { heightKm: 6, band: "upper", speedKt: 75, directionDeg: 256 },
    { heightKm: 9, band: "upper", speedKt: 85, directionDeg: 266 },
  ],
  strong_cap_high_instability: [
    { heightKm: 0, band: "surface", speedKt: 9, directionDeg: 175 },
    { heightKm: 0.5, band: "low", speedKt: 15, directionDeg: 195 },
    { heightKm: 1, band: "low", speedKt: 20, directionDeg: 210 },
    { heightKm: 2, band: "mid", speedKt: 25, directionDeg: 222 },
    { heightKm: 3, band: "mid", speedKt: 29, directionDeg: 232 },
    { heightKm: 6, band: "upper", speedKt: 35, directionDeg: 244 },
    { heightKm: 9, band: "upper", speedKt: 41, directionDeg: 252 },
  ],
  stale_data: [
    { heightKm: 0, band: "surface", speedKt: 15, directionDeg: 160 },
    { heightKm: 0.5, band: "low", speedKt: 28, directionDeg: 185 },
    { heightKm: 1, band: "low", speedKt: 38, directionDeg: 205 },
    { heightKm: 2, band: "mid", speedKt: 46, directionDeg: 225 },
    { heightKm: 3, band: "mid", speedKt: 52, directionDeg: 240 },
    { heightKm: 6, band: "upper", speedKt: 64, directionDeg: 258 },
    { heightKm: 9, band: "upper", speedKt: 74, directionDeg: 268 },
  ],
  partial_data: [
    { heightKm: 0, band: "surface", speedKt: 8, directionDeg: 170 },
    { heightKm: 0.5, band: "low", speedKt: 14, directionDeg: 190 },
    { heightKm: 1, band: "low", speedKt: 18, directionDeg: 205 },
  ],
};

export function buildHodograph(
  scenario: SimulationScenario,
  metrics: NormalizedMetric[],
  source: MetricSource | null,
  freshness: StormIntelFreshness,
): HodographData {
  if (scenario === "provider_failure" || scenario === "unavailable_unit_location") {
    return { levels: [], srh01: null, srh03: null, shear06: null, source: null, freshness: "unavailable", simulation: true };
  }
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  return {
    levels: HODOGRAPH_PROFILES[scenario],
    srh01: byKey.get("srh_0_1km")?.value ?? null,
    srh03: byKey.get("srh_0_3km")?.value ?? null,
    shear06: byKey.get("bulk_shear_0_6km")?.value ?? null,
    source,
    freshness,
    simulation: true,
  };
}

export function publicLocationFor(scenario: SimulationScenario): PublicLocationInfo | null {
  if (scenario === "unavailable_unit_location") return null;
  return {
    city: "Norman",
    state: "OK",
    elevationFt: 1198,
    nearbyChaserCount: scenario === "severe_supercell" || scenario === "high_end_tornadic" ? 12 : null,
  };
}
