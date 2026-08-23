export interface SpotterSubmissionInput {
  reportType: "S" | "W";
  tornado: boolean;
  funnelCloud: boolean;
  wallCloud: boolean;
  rotation: boolean;
  hail: boolean;
  wind: boolean;
  flood: boolean;
  flashFlood: boolean;
  other: boolean;
  hailSizeIn: number | null;
  windSpeedMph: number | null;
  windMeasured: boolean;
  damage: boolean;
  injury: boolean;
  narrative: string;
  lat: number;
  lon: number;
}

export interface SubmissionLedgerEntry {
  fingerprint: string;
  state: "SUBMITTED" | "UNKNOWN";
  updatedAt: number;
}

export interface SubmissionLedger {
  entries: SubmissionLedgerEntry[];
}

export const MAX_SPOTTER_SUBMISSION_LEDGER_ENTRIES = 50;

function validCoord(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function compactSpotterSubmissionText(value: string, maxLength: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function spotterReportFingerprint(accountId: string, input: SpotterSubmissionInput) {
  const flags = [
    input.reportType,
    input.tornado,
    input.funnelCloud,
    input.wallCloud,
    input.rotation,
    input.hail,
    input.wind,
    input.flood,
    input.flashFlood,
    input.other,
    input.hailSizeIn ?? "",
    input.windSpeedMph ?? "",
    input.windMeasured,
    input.damage,
    input.injury,
    compactSpotterSubmissionText(input.narrative, 500),
    input.lat.toFixed(4),
    input.lon.toFixed(4),
  ];
  return `${accountId}:${flags.join("|")}`;
}

export function validateSpotterSubmission(input: SpotterSubmissionInput): string {
  if (input.reportType !== "S" && input.reportType !== "W") return "Report type is invalid.";
  if (!validCoord(input.lat, input.lon)) return "Report location is invalid.";
  const anyHazard = input.tornado || input.funnelCloud || input.wallCloud || input.rotation || input.hail || input.wind || input.flood || input.flashFlood || input.other;
  if (!anyHazard) return "Select at least one hazard type.";
  if (input.narrative.length > 500) return "Report narrative must be 500 characters or less.";
  if (input.hailSizeIn != null && (!Number.isFinite(input.hailSizeIn) || input.hailSizeIn < 0 || input.hailSizeIn > 8)) return "Hail size is outside a valid range.";
  if (input.windSpeedMph != null && (!Number.isFinite(input.windSpeedMph) || input.windSpeedMph < 0 || input.windSpeedMph > 250)) return "Wind speed is outside a valid range.";
  return "";
}

export function upsertSpotterSubmissionLedger(
  ledger: SubmissionLedger,
  fingerprint: string,
  state: SubmissionLedgerEntry["state"],
  now = Date.now(),
): SubmissionLedger {
  const entries = ledger.entries.filter((entry) => entry.fingerprint !== fingerprint);
  entries.unshift({ fingerprint, state, updatedAt: now });
  return { entries: entries.slice(0, MAX_SPOTTER_SUBMISSION_LEDGER_ENTRIES) };
}

