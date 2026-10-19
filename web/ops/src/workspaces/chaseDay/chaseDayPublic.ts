import { clock } from './chaseDayModel';
export type PublicBrief = {
    date: number;
    category: string;
    place?: string | null;
    start?: number;
    end?: number;
};
// Deliberate allowlist of public fields: no private model or unit objects accepted.
export function publicText(brief: PublicBrief, holdArea = true): string {
    const place = brief.place?.trim();
    const safePlace = place && !/[\d\r\n]|setup-|https?:/i.test(place) ? place : null;
    const category = /^(MRGL|SLGT|ENH|MDT|HIGH|TSTM \/ none)$/.test(brief.category) ? brief.category : 'Unavailable';
    return [new Date(brief.date).toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric' }),
        `SPC Day 1: ${category} · https://www.spc.noaa.gov/`,
        holdArea || !safePlace ? 'Target area TBA' : `Target area: ${safePlace}`,
        `Valid window: ${clock(brief.start ?? NaN)} – ${clock(brief.end ?? NaN)}`,
        'Official NWS watches and warnings are authoritative.', 'Screening summary, not a forecast.'].join('\n');
}
