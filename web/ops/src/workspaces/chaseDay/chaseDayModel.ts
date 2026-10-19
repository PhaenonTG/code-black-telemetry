import { formatOpsTime } from "../../core/timeFormat";
import type { Catalog } from '../setupHorizons/HorizonCatalog';
import type { PotentialPayload } from '../tornadoPotentialModel';
import type { SoundingPointResult, SoundingParameter } from '../../core/types';
import { rankedCandidates } from '../setupCandidateModel';
import { distanceMiles } from '../chaseIntelModel';
import { isChaserUnit, liveChaserFix, locationPoint, timestampMs } from '../../core/referenceLocation';
import { sunsetUtc } from './solar';
/** Screening thresholds, owner-tunable; not forecast probabilities. */
export const GO_THRESHOLDS = { default: { cape: 1000, shear: 35, srh: 100 }, hslc: { cape: 250, shear: 50, srh: 200 }, cin: -75, lcl: 1500, tier: 2, tornado: 5, spcRank: 2, marginalRank: 1, noAreaTornado: 2, weakShear: 25, driveHours: 5, arrivalGraceMs: 3600000 } as const;
export type State = 'LIVE' | 'STALE' | 'UNAVAILABLE' | 'CHECKING';
export type Source<T> = {
    value: T | null;
    failed?: boolean;
    loading?: boolean;
    slow?: boolean;
};
export type Briefing = {
    setup_id: string;
    revision: number;
    generated_at: string;
    valid_from: string;
    valid_until: string;
    is_current_revision?: boolean;
    workflow?: {
        decision?: {
            decision?: string | null;
        } | null;
    };
    official: {
        day?: number;
        risk_label?: string;
        risk_code?: number;
        issued_at?: string;
    };
    model: {
        target_points?: Parameters<typeof rankedCandidates>[0];
    };
};
export type Briefings = {
    status: string;
    last_source_check_at?: string;
    items: Briefing[];
    drafts: number;
};
export type DayData = {
    catalog: Source<Catalog>;
    potential: Source<PotentialPayload>;
    briefing: Source<Briefings>;
    sounding: Source<SoundingPointResult>;
};
export const emptyData = (): DayData => ({ catalog: { value: null }, potential: { value: null }, briefing: { value: null }, sounding: { value: null } });
export function timeMs(value?: string | null): number { return value ? Date.parse(value.trim().replace(' ', 'T')) : NaN; }
export function ageMs(value: string | undefined | null, now: number): number | null { const t = timeMs(value); return Number.isFinite(t) ? Math.max(0, now - t) : null; }
export function sourceState<T>(source: Source<T>, at: string | undefined | null, maxAge: number, now: number, unavailable = false, stale = false): {
    state: State;
    ageMs: number | null;
} {
    const age = ageMs(at, now);
    return { state: !source.value ? source.loading ? 'CHECKING' : 'UNAVAILABLE' : unavailable ? 'UNAVAILABLE' : source.failed || stale || age === null || age > maxAge ? 'STALE' : 'LIVE', ageMs: age };
}
export const approved = (b: Briefing) => b.workflow?.decision?.decision === 'approved' && b.is_current_revision !== false;
export function selectBriefing(items: Briefing[], now: number): Briefing | null {
    return items.filter(b => approved(b) && b.official.day === 1 && timeMs(b.valid_from) <= now && now <= timeMs(b.valid_until)).sort((a, b) => timeMs(b.generated_at) - timeMs(a.generated_at))[0] ?? null;
}
export function targetPoint(b: Briefing | null) { return rankedCandidates(b?.model.target_points ?? [])[0] ?? null; }
export function pointInPolygon(lon: number, lat: number, rings: number[][][]): boolean {
    const inside = (ring: number[][]) => {
        let result = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [x, y] = ring[i], [xj, yj] = ring[j];
            if (Math.abs((lon - x) * (yj - y) - (lat - y) * (xj - x)) < 1e-9 && lon >= Math.min(x, xj) && lon <= Math.max(x, xj) && lat >= Math.min(y, yj) && lat <= Math.max(y, yj))
                return true;
            if ((y > lat) !== (yj > lat) && lon < (xj - x) * (lat - y) / (yj - y) + x)
                result = !result;
        }
        return result;
    };
    return !!rings.length && inside(rings[0]) && !rings.slice(1).some(inside);
}
// HorizonCatalog explicitly identifies 2 as general thunder. Prefer categorical labels;
// probability product codes (2/5/10/15) must never be interpreted as category ranks.
export function spcRank(code?: number, label = ''): number {
    if (/thunder|\bTSTM\b/i.test(label) || code === 2)
        return 0;
    if (/\bHIGH\b/i.test(label))
        return 5;
    if (/moderate|\bMDT\b/i.test(label))
        return 4;
    if (/enhanced|\bENH\b/i.test(label))
        return 3;
    if (/slight|\bSLGT\b/i.test(label))
        return 2;
    if (/marginal|\bMRGL\b/i.test(label))
        return 1;
    // Undocumented numeric codes alone are insufficient to establish a category.
    return 0;
}
export const category = (rank: number) => ['TSTM / none', 'MRGL', 'SLGT', 'ENH', 'MDT', 'HIGH'][rank] ?? 'Unknown';
export function parameter(p?: SoundingParameter): number | null {
    if (p?.value === null || p?.value === undefined || p.value === '' || typeof p.value === 'string' && !p.value.trim())
        return null;
    let n = Number(p.value);
    if (!Number.isFinite(n))
        return null;
    if (/^(m\/s|m s-1|m s\^-1|ms-1)$/i.test(p.unit.trim()))
        n *= 1.94384;
    if (/^(ft|feet)$/i.test(p.unit.trim()))
        n *= 0.3048;
    return n;
}
export function chaserRows(units: unknown[], target: ReturnType<typeof targetPoint>, now: number) {
    return units.filter(isChaserUnit).map(raw => {
        const u = raw as {
            unit_id?: string;
            display_name?: string;
            name?: string;
            location?: {
                observed_at?: unknown;
                valid?: boolean;
                has_fix?: boolean;
            };
        };
        const live = liveChaserFix(u, now), point = live?.point ?? locationPoint(u.location), at = live?.observedAt ?? timestampMs(u.location?.observed_at), age = at === null ? null : now - at;
        const usable = point && target && age !== null && age >= -10000 && age <= 6 * 3600000 && u.location?.valid !== false && u.location?.has_fix !== false;
        const miles = usable ? distanceMiles(point, { lat: target.latitude, lon: target.longitude }) : null;
        const driveMs = miles === null ? null : Math.round(miles * 1.25 / 55 * 12) * 300000;
        return { name: u.display_name ?? u.name ?? u.unit_id ?? 'Chaser', ageMs: age, state: live ? 'LIVE' : usable ? 'LAST KNOWN' : 'No usable position', miles, driveMs, arrival: driveMs === null ? null : now + driveMs };
    });
}
export function clock(at: number) { return Number.isFinite(at) ? formatOpsTime(at) : '—'; }
export function duration(ms: number | null) { if (ms === null)
    return '—'; const m = Math.max(0, Math.round(ms / 60000)); return `${Math.floor(m / 60)}h ${m % 60}m`; }
export function windowText(start: number, end: number, now: number) { return !Number.isFinite(start) ? 'Window unavailable' : now < start ? `Window starts in ${duration(start - now)}` : now > end ? 'Window expired' : `Window open · ends ${clock(end)}`; }
export function mergeChaseDay(data: DayData, units: unknown[], fabricStale: boolean, now: number) {
    const index = data.briefing.value;
    const expired = (index?.items ?? []).filter(b => approved(b) && b.official.day === 1 && timeMs(b.valid_until) < now && now - timeMs(b.valid_until) <= 24 * 3600000).sort((a, b) => timeMs(b.generated_at) - timeMs(a.generated_at))[0];
    const b = selectBriefing(index?.items ?? [], now) ?? expired ?? null, target = targetPoint(b), snd = data.sounding.value, d = snd?.derived ?? {};
    const cape = parameter(d.mlcape), shear = parameter(d.shear_0_6km), srh = parameter(d.srh_0_1km_calc), cin = parameter(d.mlcin), lcl = parameter(d.lcl_height);
    const src = data.catalog.value?.sources.find(s => s.day === 1), pot = data.potential.value;
    const inputs = {
        spc: sourceState(data.catalog, src?.checked_at, 90 * 60000, now, !src || ['unavailable', 'insufficient_input'].includes(src.status), src?.status === 'stale' || data.catalog.value?.cache_state !== 'live'),
        potential: sourceState(data.potential, pot?.generated_at, 75 * 60000, now, pot?.status === 'unavailable', pot?.status === 'stale'),
        sounding: sourceState(data.sounding, snd?.generated_at, 3 * 3600000, now, !!snd && [cape, shear, srh].includes(null), !!snd && (!Number.isFinite(timeMs(snd.valid_time)) || Math.abs(timeMs(snd.valid_time) - now) > 3 * 3600000)),
        briefing: sourceState(data.briefing, index?.last_source_check_at, 90 * 60000, now, false, index?.status !== 'ready'),
        fabric: { state: fabricStale ? 'STALE' as State : 'LIVE' as State, ageMs: null },
    };
    const regions = data.catalog.value?.records.filter(r => r.day === 1 && !/tornado|wind|hail|probab/i.test(r.kind) && timeMs(r.valid_from) <= now && now <= timeMs(r.valid_until) && target && (r.geometry.type === 'Polygon' ? pointInPolygon(target.longitude, target.latitude, r.geometry.coordinates) : r.geometry.coordinates.some(poly => pointInPolygon(target.longitude, target.latitude, poly)))) ?? [];
    const rank = Math.max(0, ...regions.map(r => spcRank(r.official_code, r.label))), spc = category(rank);
    const tier = target && pot ? Math.max(0, ...pot.features.filter(f => pointInPolygon(target.longitude, target.latitude, f.geometry.coordinates)).map(f => f.properties.tier)) : null;
    const probability = typeof b?.official.risk_code === 'number' && Number.isFinite(b.official.risk_code) ? b.official.risk_code : null;
    const chasers = chaserRows(units, target, now), bestChaser = chasers.filter(c => c.arrival !== null).sort((a, c) => a.arrival! - c.arrival!)[0] ?? null;
    const windowStart = timeMs(target?.valid_time ?? b?.valid_from), sunset = target ? sunsetUtc(target.latitude, target.longitude, new Date(now)) : null;
    const reasons: string[] = [];
    let verdict: 'GO' | 'CONDITIONAL' | 'NO-GO' | 'INSUFFICIENT DATA' = 'CONDITIONAL', path: 'default' | 'hslc' | null = null;
    const failures = (p: typeof GO_THRESHOLDS.default | typeof GO_THRESHOLDS.hslc) => [
        cape !== null && cape < p.cape ? `MLCAPE ${Math.round(cape / 10) * 10} < ${p.cape}` : null,
        shear !== null && shear < p.shear ? `Shear ${Math.round(shear)} kt < ${p.shear}` : null,
        srh !== null && srh < p.srh ? `SRH ${Math.round(srh / 10) * 10} < ${p.srh}` : null
    ].filter((s): s is string => !!s);
    const standard = failures(GO_THRESHOLDS.default), hslc = failures(GO_THRESHOLDS.hslc);
    // Choose the closer path by summed proportional deficits, with default winning ties.
    const deficit = (p: typeof GO_THRESHOLDS.default | typeof GO_THRESHOLDS.hslc) => Math.max(0, 1 - (cape ?? 0) / p.cape) + Math.max(0, 1 - (shear ?? 0) / p.shear) + Math.max(0, 1 - (srh ?? 0) / p.srh);
    if (rank < GO_THRESHOLDS.spcRank && (probability === null || probability < GO_THRESHOLDS.tornado))
        reasons.push(`SPC ${spc} < SLGT${probability === null ? '' : ` · Tornado ${probability}% < ${GO_THRESHOLDS.tornado}%`}`);
    if (tier === null || tier < GO_THRESHOLDS.tier)
        reasons.push(`Tier ${tier ?? '—'} < ${GO_THRESHOLDS.tier}`);
    if (cin !== null && cin < GO_THRESHOLDS.cin)
        reasons.push(`Capped (MLCIN ${String(Math.round(cin)).replace('-', '−')} < ${String(GO_THRESHOLDS.cin).replace('-', '−')})`);
    if (lcl !== null && lcl > GO_THRESHOLDS.lcl)
        reasons.push(`High bases (LCL ${Math.round(lcl / 10) * 10} m > ${GO_THRESHOLDS.lcl})`);
    if (!bestChaser)
        reasons.push('No usable chaser position');
    else {
        if (bestChaser.driveMs! > GO_THRESHOLDS.driveHours * 3600000)
            reasons.push(`Est. drive ${duration(bestChaser.driveMs)} > ${GO_THRESHOLDS.driveHours}h`);
        if (!Number.isFinite(windowStart))
            reasons.push('Arrival window unavailable');
        else if (bestChaser.arrival! > windowStart + GO_THRESHOLDS.arrivalGraceMs)
            reasons.push(`Arrival ${clock(bestChaser.arrival!)} > ${clock(windowStart + GO_THRESHOLDS.arrivalGraceMs)} (window +1h)`);
    }
    Object.entries(inputs).forEach(([key, input]) => { if (input.state !== 'LIVE')
        reasons.push(`${key} ${input.state}`); });
    const incomplete = [cape, shear, srh].includes(null);
    if (b && timeMs(b.valid_until) < now) {
        verdict = 'NO-GO';
        reasons.unshift('Briefing expired');
    }
    else if (!b || !target || [inputs.spc, inputs.potential, inputs.sounding].filter(i => i.state === 'STALE' || i.state === 'UNAVAILABLE').length >= 2) {
        verdict = 'INSUFFICIENT DATA';
        reasons.unshift('No complete current reviewed briefing / core evidence');
    }
    else if (inputs.spc.state === 'LIVE' && inputs.potential.state === 'LIVE' && rank < GO_THRESHOLDS.marginalRank && (probability === null || probability < GO_THRESHOLDS.noAreaTornado) && tier === 0 || cape !== null && shear !== null && cape < GO_THRESHOLDS.hslc.cape && shear < GO_THRESHOLDS.weakShear) {
        verdict = 'NO-GO';
        reasons.unshift('Environment below screening minimums');
    }
    else if (!incomplete && reasons.length === 0 && (!standard.length || !hslc.length)) {
        verdict = 'GO';
        path = standard.length ? 'hslc' : 'default';
        if (path === 'hslc')
            reasons.push('High-shear/low-CAPE setup');
    }
    else
        reasons.push(...(deficit(GO_THRESHOLDS.hslc) < deficit(GO_THRESHOLDS.default) ? hslc : standard));
    if (['stp', 'stp_fixed', 'significant_tornado_parameter'].some(k => (parameter(d[k]) ?? 0) >= 1))
        reasons.push('Sig-tor parameter favorable');
    return { verdict, path, reasons, inputs, b, target, spc, rank, tier, probability, cape, shear, srh, cin, lcl, chasers, bestChaser, windowStart, sunset, now };
}
export type DayModel = ReturnType<typeof mergeChaseDay>;
