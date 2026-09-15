// Analog Matches -- reserved contract, V1 (foundation only, no engine yet).
//
// A future historical-profile indexing job populates this; nothing in this codebase invents a
// match or a percentage today. The contract exists now so that job can slot in later without an
// OPS redesign -- see AnalogMatchesPanel.tsx, which renders exactly this shape or an explicit
// "not populated" state, never a fabricated example.
//
// Similarity is ALWAYS environmental resemblance -- never a forecast, never "probability this
// outcome repeats." Historical outcome metadata (what actually happened at the matched date/
// place) is kept structurally separate from the similarity score so nothing downstream can
// blend "similar environment" with "likely result."

export const ANALOG_MATCHES_CONTRACT_VERSION = "1.0.0";

// The environmental fingerprint a future similarity engine compares against. Every field here
// must be derivable from the same canonical sounding/profile service already powering this
// workspace -- no new meteorological source.
export interface AnalogEnvironmentalFingerprint {
  schemaVersion: typeof ANALOG_MATCHES_CONTRACT_VERSION;
  profile: {
    pressureHpa: number[];
    tempC: number[];
    dewpC: number[];
  };
  windProfile: {
    heightM: number[];
    uMs: number[];
    vMs: number[];
  };
  sbcapeJKg: number | null;
  sbcinJKg: number | null;
  lclHeightM: number | null;
  shear0_6kmKt: number | null;
  shear0_1kmKt: number | null;
  srh0_1kmM2s2: number | null;
  srh0_3kmM2s2: number | null;
  lapseRate0_3kmCPerKm: number | null;
  pwatMm: number | null;
  stormMotion: { rmDegKt: string | null; lmDegKt: string | null };
  seasonMonth: number;
  localHourOfDay: number;
  latitude: number;
  longitude: number;
  // Reserved for a later pass -- mesoscale/radar context is explicitly out of scope for the
  // indexing job this contract first ships with.
  mesoscaleContext: null;
}

export type AnalogSimilarityBasis = "environmental_fingerprint_v1";

export interface AnalogMatch {
  matchId: string;
  // 0-1, environmental resemblance only. NEVER a probability of any particular outcome.
  similarityScore: number;
  similarityBasis: AnalogSimilarityBasis;
  matchedAt: string; // ISO date of the historical case
  matchedLocation: { displayName: string; latitude: number; longitude: number };
  // Kept separate from similarity on purpose -- consumers must not average/blend these two
  // concepts. Absent fields stay absent; this UI never fills in a plausible-sounding outcome.
  historicalOutcome: {
    summary: string | null;
    verifiedReports: number | null;
    sourceUrl: string | null;
  } | null;
}

export interface AnalogMatchesResult {
  schemaVersion: typeof ANALOG_MATCHES_CONTRACT_VERSION;
  available: boolean;
  unavailableReason: string | null;
  matches: AnalogMatch[];
}

// V1 has no indexing job yet -- this is the only value ever produced this pass, and it is
// exactly what a genuinely-unpopulated engine should honestly report.
export const ANALOG_MATCHES_NOT_YET_AVAILABLE: AnalogMatchesResult = {
  schemaVersion: ANALOG_MATCHES_CONTRACT_VERSION,
  available: false,
  unavailableReason: "Historical analog index has not been built yet.",
  matches: [],
};
