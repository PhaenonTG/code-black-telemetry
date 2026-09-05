import type { DataClass, MetricSource } from "./types";

/**
 * Provider names Core is known to use for true human/instrument observation networks. Empty
 * today -- Core only ships an HRRR provider (`hrrr-nomads`), a pure NWP model. Listed explicitly
 * (not inferred) so adding a real observation provider later is a one-line addition here, not a
 * guess baked into the classification logic.
 */
const KNOWN_OBSERVATION_PROVIDERS = new Set<string>([
  // e.g. "metar", "mesonet" -- none exist in Core yet.
]);

/**
 * A model valid time this far or more after its run time counts as a forecast, not an analysis.
 * HRRR (Core's only real provider today) steps in 1-hour forecast-hour increments, so anything
 * under an hour of gap is run/valid-time rounding noise, not a genuine forecast lead time.
 */
const FORECAST_LEAD_EPSILON_MS = 60 * 60 * 1000;

/**
 * Derives the OBSERVATION / MODEL_ANALYSIS / MODEL_FORECAST distinction Core's `MetricSource`
 * does not carry as a field. Defaults to MODEL_ANALYSIS whenever provenance is ambiguous --
 * never defaults to OBSERVATION, per "never present model values as observations."
 */
export function classifyDataClass(source: MetricSource | null): DataClass | null {
  if (!source) return null;

  if (KNOWN_OBSERVATION_PROVIDERS.has(source.provider.toLowerCase())) {
    return "OBSERVATION";
  }

  if (source.runTime && source.validTime) {
    const runMs = Date.parse(source.runTime);
    const validMs = Date.parse(source.validTime);
    if (Number.isFinite(runMs) && Number.isFinite(validMs) && validMs - runMs >= FORECAST_LEAD_EPSILON_MS) {
      return "MODEL_FORECAST";
    }
  }

  return "MODEL_ANALYSIS";
}
