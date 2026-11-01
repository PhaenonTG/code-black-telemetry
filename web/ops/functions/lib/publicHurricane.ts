/** Public-only hurricane feed. Never forward the private OPS snapshot verbatim. */
import { forwardToCore, type GatewayEnv } from "./coreGateway";

export const PUBLIC_HURRICANE_PATH = "/api/public/hurricane";
const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active";
const CORE_ROUTE = { upstreamPath: "/api/forecast/v1/hurricane-watch", allowedQueryParams: [] };
const MODEL_IDS = new Set(["HFAI", "HFBI", "AVNI", "EMXI", "UKXI", "CMCI", "NVGI", "CTCI", "HWFI", "HMNI"]);
const DISPLAY_MODEL_IDS = new Set([...MODEL_IDS, "AEMI", "GDMI", "HCCA", "TVCN"]);
const MARITIME_STATIONS = new Set(["42001", "42012", "42039", "PCLF1"]);
const PUBLIC_ORIGINS = new Set([
  "https://tropics.codeblackwx.com",
  "https://hurricane.codeblackwx.com",
  "https://storms.codeblackwx.com",
  "https://codeblack-hurricane.pages.dev",
]);

type Dict = Record<string, unknown>;
type Position = { latitude: number; longitude: number };
const object = (value: unknown): Dict => value && typeof value === "object" && !Array.isArray(value) ? value as Dict : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const number = (value: unknown): number | null => {
  const result = Number(value);
  return value !== null && value !== undefined && value !== "" && Number.isFinite(result) ? result : null;
};
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
// The Core assessment may know a private watch point. Publish only guarded,
// non-numeric narrative; never forward raw AI output or private identifiers.
const privateNarrative = /\d|@|https?:|rolling\s+meadows|\b(?:street|st\.?|road|rd\.?|lane|ln\.?|drive|dr\.?|avenue|ave\.?|boulevard|blvd\.?)\b/i;
const lowValueNarrative = /\b(?:unsupported with no available fields|no available fields|insufficient data to analyze|as an ai language model)\b/i;
const publicNarrative = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const prose = value.trim();
  return prose && prose.length <= 1050 && !privateNarrative.test(prose) && !lowValueNarrative.test(prose) ? prose : null;
};
const publicSummary = (value: unknown): string | null => {
  const prose = typeof value === "string" ? value.trim() : "";
  return prose && prose.length <= 1900 && !privateNarrative.test(prose) && !lowValueNarrative.test(prose) ? prose : null;
};
const publicNarrativeList = (value: unknown): string[] =>
  array(value).slice(0, 5).map(publicNarrative).filter((item): item is string => !!item);
const officialUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["www.nhc.noaa.gov", "www.weather.gov", "api.weather.gov"].includes(url.hostname) ? url.toString() : null;
  } catch { return null; }
};
const point = (value: unknown): Position | null => {
  const row = object(value), latitude = number(row.latitude), longitude = number(row.longitude);
  return latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
};
const trackPoint = (value: unknown) => {
  const row = object(value), coordinates = point(row), hour = number(row.hour);
  if (!coordinates || hour === null || hour < 0 || hour > 120) return null;
  return { ...coordinates, hour, valid_time: string(row.valid_time), wind_mph: number(row.wind_mph) };
};
const haversineMiles = (a: Position, b: Position) => {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians, dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.76 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

function positionAt(points: ReturnType<typeof trackPoint>[], validMs: number): Position | null {
  const valid = points.filter((entry): entry is NonNullable<typeof entry> => !!entry && !!entry.valid_time)
    .map((entry) => ({ ...entry, ms: Date.parse(entry.valid_time!) })).filter((entry) => Number.isFinite(entry.ms)).sort((a, b) => a.ms - b.ms);
  const exact = valid.find((entry) => entry.ms === validMs);
  if (exact) return { latitude: exact.latitude, longitude: exact.longitude };
  const upperIndex = valid.findIndex((entry) => entry.ms > validMs);
  if (upperIndex <= 0) return null;
  const lower = valid[upperIndex - 1], upper = valid[upperIndex];
  if (upper.ms - lower.ms > 24 * 3600_000) return null;
  const fraction = (validMs - lower.ms) / (upper.ms - lower.ms);
  return { latitude: lower.latitude + (upper.latitude - lower.latitude) * fraction,
    longitude: lower.longitude + (upper.longitude - lower.longitude) * fraction };
}

/** Pure diagnostic mirror of Core's unanchored dynamical-aid median. */
export function deriveProjection(models: unknown[], latestCycle: unknown) {
  const cycle = string(latestCycle), start = cycle ? Date.parse(cycle) : NaN;
  if (!Number.isFinite(start)) return { status: "unavailable", points: [], method: "Fresh dynamical center-track median" };
  const members = models.map(object).filter((model) => MODEL_IDS.has(String(model.id)) && Array.isArray(model.points)
    && typeof model.cycle === "string" && start - Date.parse(model.cycle) <= 12 * 3600_000)
    .map((model) => ({ id: String(model.id), cycle: string(model.cycle), points: array(model.points).map(trackPoint) }));
  const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
  const points = [];
  for (const hour of [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 84, 96, 108, 120]) {
    const validMs = start + hour * 3600_000;
    const positions = members.map((model) => positionAt(model.points, validMs)).filter((item): item is Position => !!item);
    if (positions.length < 2) continue;
    const latitude = median(positions.map((item) => item.latitude));
    const longitude = median(positions.map((item) => item.longitude));
    let spread = 0;
    for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
      spread = Math.max(spread, haversineMiles(positions[i], positions[j]));
    }
    points.push({ hour, valid_time: new Date(validMs).toISOString(), latitude: +latitude.toFixed(3), longitude: +longitude.toFixed(3),
      spread_miles: Math.round(spread), members: positions.length });
  }
  return { status: points.length >= 3 ? "ready" : "unavailable", points: points.length >= 3 ? points : [],
    cycle, method: "Coordinate median of fresh dynamical center tracks; consensus aids excluded. Experimental, not calibrated or official.",
    member_ids: members.map((model) => model.id) };
}

export function toPublicHurricane(raw: unknown) {
  const data = object(raw), storm = object(data.storm), guidance = object(data.model_guidance), trend = object(data.observed_trend), assessment = object(data.assessment), ai = object(data.ai), changes = object(data.changes_since_previous), radar = object(data.radar);
  const rawLandfall = object(data.official_landfall);
  const confirmationObservedAt = string(rawLandfall.observed_at) ?? string(rawLandfall.at);
  const postLandfall = rawLandfall.status === "confirmed" && !!string(rawLandfall.at);
  const reviewReady = (ai.status === "ready" || ai.status === "stale") && ["qwen3-coder:30b", "gpt-6.1-sol", "gpt-6-luna"].includes(String(ai.review_model))
    && (ai.review_verdict === "approve" || ai.review_verdict === "revise") && !!string(ai.reviewed_at);
  const summaryText = String(ai.summary);
  // Keep invented multiple observed centers out of the public briefing, but do
  // not suppress an approved reviewer that explicitly says those centers are
  // *not* observed while explaining model/track uncertainty.
  const claimsMultipleCenters = /(?:multiple|several|two)\s+(?:storm|hurricane|cyclone)\s+centers/i.test(summaryText) &&
    !/(?:storm|hurricane|cyclone)\s+centers?\s+(?:are|is)?\s*not\s+observed/i.test(summaryText);
  const postLandfallConflict = postLandfall && /without claiming landfall|(?:does not|cannot|can't|not)\s+(?:verify|confirm)\b.{0,60}\blandfall\b|future (?:coastal )?crossing|before landfall|landfall (?:has )?not (?:been )?confirmed|(?:coastal[- ]crossing|landfall) status.{0,30}(?:unresolved|uncertain|unconfirmed)/i.test(summaryText);
  const acknowledgesLandfall = !postLandfall || /\b(?:NHC[- ]confirmed landfall|NHC.{0,40}(?:confirms|confirmed|reports|reported).{0,30}(?:landfall|coastal crossing)|(?:has |had |was )?made landfall|observed landfall (?:near|at)|confirmed (?:coastal crossing|center crossing))\b/i.test(summaryText);
  const postLandfallReviewIsFresh = !postLandfall || !!(confirmationObservedAt && string(ai.analyzed_at) && string(ai.reviewed_at)
    && Date.parse(string(ai.analyzed_at)!) >= Date.parse(confirmationObservedAt)
    && Date.parse(string(ai.reviewed_at)!) >= Date.parse(confirmationObservedAt));
  const inconsistent = claimsMultipleCenters || postLandfallConflict || !acknowledgesLandfall || !postLandfallReviewIsFresh ||
    (array(data.maritime_observations).some(row => object(row).status === "ready") && /surface observations? (?:are |is )?(?:missing|unavailable|absent)/i.test(summaryText));
  const aiSummary = reviewReady && !inconsistent ? publicSummary(ai.summary) : null;
  const nextHour = reviewReady ? publicNarrative(ai.next_hour_outlook) : null;
  const selectedLandfall = object(ai.landfall);
  const candidate = array(data.landfall_candidates).map(object).find((row) =>
    row.id === selectedLandfall.id && row.center_time === selectedLandfall.center_time &&
    row.latitude === selectedLandfall.latitude && row.longitude === selectedLandfall.longitude);
  const aiLandfall = aiSummary && ai.input_fingerprint === data.input_fingerprint && candidate &&
    (candidate.id === "NHC" || candidate.id === "BLEND" || MODEL_IDS.has(String(candidate.id))) &&
    Number.isFinite(Date.parse(String(candidate.center_time))) &&
    number(candidate.latitude) !== null && number(candidate.longitude) !== null &&
    typeof candidate.region === "string" && /^[A-Za-z /]+$/.test(candidate.region) &&
    (candidate.nearest_city === null || typeof candidate.nearest_city === "string" && /^[A-Za-z .,]+$/.test(candidate.nearest_city))
    ? { source: String(candidate.id), center_time: String(candidate.center_time),
        window_start: string(candidate.window_start), window_end: string(candidate.window_end),
        latitude: Number(candidate.latitude), longitude: Number(candidate.longitude),
        region: candidate.region, nearest_city: candidate.nearest_city } : null;
  const rawDecision = object(ai.decision_record);
  const decisionCurrent = !!aiSummary && ai.input_fingerprint === data.input_fingerprint &&
    ["gpt-6.1-sol", "gpt-6-luna"].includes(String(ai.review_model)) && !!publicNarrative(rawDecision.track_assessment);
  const altRaw = object(rawDecision.alternate_landfall);
  const altCandidate = array(data.landfall_candidates).map(object).find((row) => row.id === altRaw.id &&
    row.center_time === altRaw.center_time && row.latitude === altRaw.latitude && row.longitude === altRaw.longitude);
  const alternateLandfall = decisionCurrent && altCandidate && altCandidate.id !== object(ai.landfall).id &&
    typeof altCandidate.region === "string" && /^[A-Za-z /]+$/.test(altCandidate.region) &&
    (altCandidate.nearest_city === null || typeof altCandidate.nearest_city === "string" && /^[A-Za-z .,]+$/.test(altCandidate.nearest_city))
    ? { source: String(altCandidate.id), center_time: String(altCandidate.center_time),
        region: altCandidate.region, nearest_city: altCandidate.nearest_city } : null;
  const hazard = object(rawDecision.hazards);
  const dataRequests = array(rawDecision.data_requests).slice(0, 3).map(object).map((row) => {
    const source = publicNarrative(row.source), question = publicNarrative(row.question), why = publicNarrative(row.why);
    const priority = ["high", "medium", "low"].includes(String(row.priority)) ? String(row.priority) : null;
    return source && question && why && priority ? { source, question, why, priority } : null;
  }).filter(Boolean);
  const decisionRecord = decisionCurrent ? {
    track_assessment: publicNarrative(rawDecision.track_assessment),
    intensity_assessment: publicNarrative(rawDecision.intensity_assessment),
    confidence: ["low", "moderate", "high"].includes(String(rawDecision.confidence)) ? String(rawDecision.confidence) : "low",
    confidence_reason: publicNarrative(rawDecision.confidence_reason),
    alternate_landfall: alternateLandfall,
    hazards: { wind: publicNarrative(hazard.wind), coastal_water: publicNarrative(hazard.coastal_water),
      flooding: publicNarrative(hazard.flooding), tornado: publicNarrative(hazard.tornado) },
    changes: publicNarrativeList(rawDecision.changes), next_hour_triggers: publicNarrativeList(rawDecision.next_hour_triggers),
    missing_sources: publicNarrativeList(rawDecision.missing_sources), data_requests: dataRequests,
  } : null;
  const models = array(guidance.models).map(object).filter((model) => DISPLAY_MODEL_IDS.has(String(model.id)))
    .map((model) => ({ id: model.id, name: string(model.name), cycle: string(model.cycle),
      points: array(model.points).map(trackPoint).filter(Boolean), shift_48h_miles: number(model.shift_48h_miles) }));
  const storedProjection = object(data.projection);
  const projectionPoints = array(storedProjection.points).map((entry) => {
    const row = object(entry), base = trackPoint(entry), spread = number(row.spread_miles), members = number(row.members);
    return base && base.valid_time && spread !== null && spread >= 0 && members !== null && members >= 2
      ? { ...base, valid_time: base.valid_time, spread_miles: spread, members } : null;
  }).filter(Boolean);
  const projectionCurrent = storedProjection.status === "ready" && string(storedProjection.checked_at) === string(data.checked_at) && projectionPoints.length >= 3;
  const advisoryIssued = string(object(storm.forecastTrack).issuance);
  const modelCycle = string(storedProjection.cycle);
  const cycleLagHours = advisoryIssued && modelCycle && Number.isFinite(Date.parse(advisoryIssued)) && Number.isFinite(Date.parse(modelCycle))
    ? Math.max(0, Math.round((Date.parse(advisoryIssued) - Date.parse(modelCycle)) / 3_600_000 * 10) / 10) : null;
  const projection = { status: projectionCurrent ? "ready" : "unavailable", points: projectionCurrent ? projectionPoints : [],
    checked_at: projectionCurrent ? string(storedProjection.checked_at) : null, cycle: modelCycle, cycle_lag_hours: cycleLagHours,
    anchor_at: projectionCurrent ? string(storedProjection.anchor_at) : null,
    anchor_source: projectionCurrent ? string(storedProjection.anchor_source) : null,
    method: string(storedProjection.method) ?? "Dynamical-model track synthesis unavailable",
    member_ids: array(storedProjection.member_ids).filter((id) => typeof id === "string" && MODEL_IDS.has(id)) };
  const officialTrack = array(data.track).map(trackPoint).filter(Boolean);
  const observed = array(data.observed_track).map((entry) => {
    const row = object(entry), coordinates = point(row);
    return coordinates ? { ...coordinates, valid_time: string(row.valid_time), wind_mph: number(row.wind_mph), pressure_mb: number(row.pressure_mb) } : null;
  }).filter(Boolean);
  const rawRecon = object(data.recon);
  const reconPosition = point(rawRecon);
  const reconTime = string(rawRecon.observed_at);
  const reconReady = rawRecon.status === "ready" && reconPosition && reconTime && Number.isFinite(Date.parse(reconTime));
  const recon = { status: reconReady ? "ready" : "unavailable", observed_at: reconReady ? reconTime : null,
    latitude: reconReady ? reconPosition.latitude : null, longitude: reconReady ? reconPosition.longitude : null,
    pressure_mb: reconReady ? number(rawRecon.pressure_mb) : null,
    eye_characteristic: reconReady && typeof rawRecon.eye_characteristic === "string" && /^[A-Z0-9 /-]{1,24}$/.test(rawRecon.eye_characteristic) ? rawRecon.eye_characteristic : null,
    eye_diameter_nm: reconReady && number(rawRecon.eye_diameter_nm) !== null && Number(rawRecon.eye_diameter_nm) > 0 && Number(rawRecon.eye_diameter_nm) <= 100 ? Number(rawRecon.eye_diameter_nm) : null,
    max_flight_wind_kt: reconReady && number(rawRecon.max_flight_wind_kt) !== null && Number(rawRecon.max_flight_wind_kt) > 0 && Number(rawRecon.max_flight_wind_kt) <= 200 ? Number(rawRecon.max_flight_wind_kt) : null,
    source: "https://www.nhc.noaa.gov/text/MIAREPNT2.shtml" };
  const aircraftFixes = array(data.aircraft_fixes).slice(-96).map((entry) => {
    const row = object(entry), coordinates = point(row), observed_at = string(row.observed_at);
    return coordinates && observed_at && Number.isFinite(Date.parse(observed_at))
      ? { ...coordinates, observed_at, pressure_mb: number(row.pressure_mb) } : null;
  }).filter(Boolean);
  const maritime = array(data.maritime_observations).map((entry) => {
    const row = object(entry), station = string(row.station);
    if (!station || !MARITIME_STATIONS.has(station)) return null;
    const observed_at = string(row.observed_at);
    const ready = row.status === "ready" && observed_at && Number.isFinite(Date.parse(observed_at));
    return { station, status: ready ? "ready" : row.status === "stale" ? "stale" : "unavailable",
      observed_at: ready ? observed_at : null, wind_m_s: ready ? number(row.wind_m_s) : null,
      gust_m_s: ready ? number(row.gust_m_s) : null, pressure_hpa: ready ? number(row.pressure_hpa) : null,
      pressure_change_3h_hpa: ready ? number(row.pressure_change_3h_hpa) : null,
      source: `https://www.ndbc.noaa.gov/data/realtime2/${station}.txt` };
  }).filter(Boolean);
  const alerts = array(data.coastal_context_alerts).map((entry) => {
    const row = object(entry);
    return { event: string(row.event), headline: string(row.headline), severity: string(row.severity), expires: string(row.expires), url: officialUrl(row.url) };
  });
  const advisory = object(storm.publicAdvisory), discussion = object(storm.forecastDiscussion);
  const confirmed = object(data.official_landfall);
  const confirmedAt = string(confirmed.at);
  const officialLandfall = confirmed.status === "confirmed" && confirmedAt && Number.isFinite(Date.parse(confirmedAt))
    && typeof confirmed.location === "string" && /^[A-Za-z ,.-]{3,70}$/.test(confirmed.location)
    && officialUrl(confirmed.source)
    ? { status: "confirmed", at: confirmedAt, observed_at: string(confirmed.observed_at),
        location: confirmed.location === confirmed.location.toUpperCase()
          ? confirmed.location.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/\s+(Florida|Alabama|Mississippi|Louisiana|Texas)$/i, ", $1")
          : confirmed.location,
        source: officialUrl(confirmed.source),
        wind_mph: number(confirmed.wind_mph), pressure_mb: number(confirmed.pressure_mb) }
    : null;
  const officialFixIsCurrent = officialLandfall && string(storm.lastUpdate) &&
    Date.parse(string(storm.lastUpdate)!) <= Date.parse(officialLandfall.at) &&
    Date.parse(officialLandfall.at) - Date.parse(string(storm.lastUpdate)!) <= 30 * 60_000;
  return {
    status: string(data.status) ?? "unavailable", checked_at: string(data.checked_at), freshness: string(data.freshness),
    verification: { status: string(object(data.verification).status) ?? "awaiting_observations",
      samples: array(object(data.verification).samples).slice(-300).map(object).filter(row => ["Code Black", "NHC"].includes(String(row.source)) && number(row.center_error_miles) !== null).map(row => ({ source: row.source, issued_at: string(row.issued_at), valid_time: string(row.valid_time), lead_hours: number(row.lead_hours), center_error_miles: number(row.center_error_miles) })),
      scorecard: array(object(data.verification).scorecard).slice(0,4).map(object).map(row => ({ lead: string(row.lead), matched_count: number(row.matched_count) ?? 0, code_black_mean_miles: number(row.code_black_mean_miles), nhc_mean_miles: number(row.nhc_mean_miles) })),
      history: array(object(data.verification).history).slice(0,6).map(object).map(row => ({ cycle: string(row.cycle), checked_at: string(row.checked_at), points: array(row.points).map(trackPoint).filter(Boolean) })) },
    storm: { id: string(storm.id), name: string(storm.name), classification: string(storm.classification), max_wind_mph: officialFixIsCurrent && officialLandfall.wind_mph !== null ? officialLandfall.wind_mph : number(assessment.intensity_mph),
      pressure_mb: officialFixIsCurrent && officialLandfall.pressure_mb !== null ? officialLandfall.pressure_mb : number(storm.pressure), center: { latitude: number(storm.latitudeNumeric), longitude: number(storm.longitudeNumeric) },
      movement_degrees: number(storm.movementDir), movement_mph: number(storm.movementSpeed), last_update: string(storm.lastUpdate) },
    official: { track: officialTrack, issued_at: advisoryIssued, landfall: officialLandfall, cone: array(data.cone).filter((entry) => Array.isArray(entry) && entry.length >= 2 && number(entry[0]) !== null && number(entry[1]) !== null).map((entry) => [Number((entry as number[])[0]), Number((entry as number[])[1])]),
      cone_status: string(data.cone_status), advisory_url: officialUrl(advisory.url), discussion_url: officialUrl(discussion.url) },
    projection, guidance: { status: string(guidance.status), latest_cycle: string(guidance.latest_cycle), models,
      spread_48h_miles: number(guidance.spread_48h_miles), wind_48h_mph_range: Array.isArray(guidance.wind_48h_mph_range) ? guidance.wind_48h_mph_range.map(number) : null },
    observed: { track: observed, trend: { period_hours: number(trend.period_hours), wind_change_mph: number(trend.wind_change_mph), pressure_change_mb: number(trend.pressure_change_mb) } },
    observations: { recon, aircraft_fixes: aircraftFixes, maritime },
    changes: { first_run: changes.first_run === true, previous_checked_at: string(changes.previous_checked_at),
      advisory_changed: changes.advisory_changed === true, wind_change_mph: number(changes.wind_change_mph), pressure_change_mb: number(changes.pressure_change_mb),
      new_alerts: array(changes.new_alerts).slice(0, 8).map(publicNarrative).filter(Boolean),
      cleared_alerts: array(changes.cleared_alerts).slice(0, 8).map(publicNarrative).filter(Boolean),
      model_cycle_changes: array(changes.model_cycle_changes).slice(0, 13).map(publicNarrative).filter(Boolean),
      new_report_count: array(changes.new_reports).length },
    monitoring: { radar_analysis: ["ready", "partial"].includes(String(radar.status)) ? radar.status : "unavailable",
      radar_observed_at: string(object(object(radar.products).reflectivity).observed_at), source_check_minutes: 5,
      paid_phase: string(object(data.paid_policy).phase), paid_model: string(object(data.paid_policy).model),
      ai_mode: "every_completed_source_check", model_tracks: models.length },
    regional_alerts: alerts, regional_alerts_status: string(data.coastal_context_status),
    ai: { status: aiSummary ? ai.status : ai.status === "ready" ? "withheld" : "unavailable",
      analyzed_at: aiSummary ? string(ai.analyzed_at) : null, summary: aiSummary,
      next_hour_outlook: aiSummary ? nextHour : null,
      landfall: aiLandfall,
      reviewed_at: aiSummary ? string(ai.reviewed_at) : null, review_model: aiSummary ? string(ai.review_model) : null,
      supporting_factors: aiSummary ? publicNarrativeList(ai.supporting_factors) : [],
      uncertainties: aiSummary ? publicNarrativeList(ai.uncertainties) : [],
      recommended_attention: aiSummary ? publicNarrativeList(ai.recommended_attention) : [],
      ...(decisionRecord ? { decision_record: decisionRecord } : {}) },
    disclosure: "Code Black Experimental is an observation-anchored synthesis of fresh dynamical center tracks; the guarded Aegis review may select a separate landfall candidate. Neither is an official forecast or local-impact prediction. Follow NHC, NWS, and local officials.",
  };
}

async function liveRegionalTornadoAlerts(cache: Cache | null, ctx?: { waitUntil(promise: Promise<unknown>): void }) {
  const cacheKey = new Request("https://ops.codeblackwx.com/api/public/hurricane/regional-tornado-alerts?v=2");
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return await cached.json() as { event: string | null; headline: string | null; expires: string | null; url: string | null; areas: string | null; geometry: unknown }[];
  try {
    const responses = await Promise.all(["AL", "MS", "LA", "FL"].map(async (area) => {
      const response = await fetch(`${NWS_ALERTS_URL}?area=${area}`, { headers: { Accept: "application/geo+json", "User-Agent": "CodeBlackTropics/1.0 (support@codeblackwx.com)" }, cf: { cacheTtl: 30, cacheEverything: true } });
      if (!response.ok) throw new Error(`NWS_${area}_${response.status}`);
      return await response.json() as { features?: unknown[] };
    }));
    const seen = new Set<string>();
    const alerts = responses.flatMap((response) => response.features ?? []).map(object).map((feature) => {
      const properties = object(feature.properties), id = string(feature.id) ?? string(properties["@id"]);
      if (!id || !/^tornado (watch|warning)$/i.test(string(properties.event) ?? "") || seen.has(id)) return null;
      seen.add(id);
      // The public map needs geometry only for active tornado warnings.  Keep
      // watches in the text briefing without drawing their huge county-scale
      // footprints over the storm map.
      const geometry = /^tornado warning$/i.test(string(properties.event) ?? "") ? object(feature.geometry) : null;
      const type = string(geometry?.type);
      const coordinates = geometry?.coordinates;
      const safeGeometry = (type === "Polygon" || type === "MultiPolygon") && Array.isArray(coordinates)
        && JSON.stringify(coordinates).length <= 200_000 ? { type, coordinates } : null;
      return { event: string(properties.event), headline: string(properties.headline), expires: string(properties.expires), url: officialUrl(string(properties["@id"])), areas: string(properties.areaDesc), geometry: safeGeometry };
    }).filter(Boolean).slice(0, 12) as { event: string | null; headline: string | null; expires: string | null; url: string | null; areas: string | null; geometry: unknown }[];
    if (cache) ctx?.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(alerts), { headers: { "Cache-Control": "public, max-age=45, s-maxage=45" } })));
    return alerts;
  } catch { return []; }
}

export async function handlePublicHurricane(request: Request, env: GatewayEnv, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = origin && PUBLIC_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "Content-Type": "application/json", ...cors } });
  const cache = typeof caches !== "undefined" ? caches.default : null;
  // Keep the public endpoint shielded while allowing a refresh to pick up a
  // completed Core check promptly. Browser no-store does not bypass Cache API.
  const cacheKey = new Request("https://ops.codeblackwx.com/api/public/hurricane?feed=v16");
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return new Response(cached.body, { status: 200, headers: { ...Object.fromEntries(cached.headers), ...cors } });
  const result = await forwardToCore(CORE_ROUTE, new URL(request.url), env);
  if (result.status !== 200) return new Response(JSON.stringify({ error: "DATA_UNAVAILABLE" }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors } });
  const tornadoAlerts = await liveRegionalTornadoAlerts(cache, ctx);
  const safe = new Response(JSON.stringify({ ...toPublicHurricane(result.body), regional_tornado_alerts: tornadoAlerts }), { status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=5, s-maxage=5", "X-Content-Type-Options": "nosniff" } });
  if (cache) ctx?.waitUntil(cache.put(cacheKey, safe.clone()));
  return new Response(safe.body, { status: 200, headers: { ...Object.fromEntries(safe.headers), ...cors } });
}
