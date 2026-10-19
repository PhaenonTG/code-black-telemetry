import { parseSoundingPreload } from './soundingPreload';
import { describe, it, expect } from 'vitest';
import { mergeChaseDay, parameter, pointInPolygon, selectBriefing, spcRank, targetPoint, windowText, GO_THRESHOLDS, chaserRows } from './chaseDayModel';
import { fixture, briefing, NOW, iso, units, polygon } from './fixtures';
const model = (d = fixture(), now = NOW) => mergeChaseDay(d, units, false, now);
describe('chase day screening', () => {
    it('selects only approved current Day 1 valid briefings and ranks the target', () => {
        const draft = briefing();
        draft.workflow = { decision: { decision: 'rejected' } };
        const expired = briefing();
        expired.valid_until = iso(NOW - 1);
        const old = briefing();
        old.is_current_revision = false;
        const day2 = briefing();
        day2.official.day = 2;
        const good = briefing();
        good.model.target_points?.push({ latitude: 36, longitude: -96, score_index: 0.9 });
        expect(selectBriefing([draft, expired, old, day2, good], NOW)).toBe(good);
        expect(targetPoint(good)?.latitude).toBe(36);
        const newer = { ...good, revision: 3, generated_at: iso(NOW + 1) };
        expect(selectBriefing([good, newer], NOW)).toBe(newer);
    });
    it('handles polygon boundaries, holes, outside, and thunder vs categorical rank', () => {
        expect(pointInPolygon(-97, 35, polygon)).toBe(true);
        expect(pointInPolygon(-80, 35, polygon)).toBe(false);
        expect(pointInPolygon(-100, 35, polygon)).toBe(true);
        expect(pointInPolygon(-97, 35, [...polygon, [[-98, 34], [-96, 34], [-96, 36], [-98, 36], [-98, 34]]])).toBe(false);
        expect(spcRank(2, 'Thunderstorms')).toBeLessThan(spcRank(3, 'MRGL'));
        expect(spcRank(5, '5% tornado probability')).toBe(0);
    });
    it('converts m/s and ft without coercing null to zero', () => {
        const p = fixture().sounding.value!.derived.shear_0_6km;
        expect(parameter({ ...p, value: 20, unit: 'm/s' })).toBeCloseTo(38.8768);
        expect(parameter({ ...p, value: 5000, unit: 'ft' })).toBe(1524);
        expect(parameter({ ...p, value: null })).toBeNull();
    });
    it('gives default GO at the inclusive threshold boundaries', () => {
        const d = fixture(), v = d.sounding.value!.derived;
        v.mlcape.value = 1000;
        v.shear_0_6km.value = 35;
        v.srh_0_1km_calc.value = 100;
        v.mlcin.value = -75;
        v.lcl_height.value = 1500;
        expect(model(d)).toMatchObject({ verdict: 'GO', path: 'default' });
        expect(GO_THRESHOLDS.default.cape).toBe(1000);
    });
    it('gives HSLC GO and fails shear 49', () => {
        const d = fixture(), v = d.sounding.value!.derived;
        v.mlcape.value = 300;
        v.shear_0_6km.value = 55;
        v.srh_0_1km_calc.value = 250;
        expect(model(d)).toMatchObject({ verdict: 'GO', path: 'hslc', reasons: ['High-shear/low-CAPE setup'] });
        v.shear_0_6km.value = 49;
        expect(model(d).verdict).toBe('CONDITIONAL');
        expect(model(d).reasons).toContain('Shear 49 kt < 50');
    });
    it('accepts tornado 5%, not 2%, for MRGL', () => {
        const d = fixture();
        d.catalog.value!.records[0].label = 'MRGL';
        expect(model(d).verdict).toBe('GO');
        d.briefing.value!.items[0].official.risk_code = 2;
        expect(model(d).verdict).toBe('CONDITIONAL');
    });
    it.each([['lcl_height', 1600, 'High bases (LCL 1600 m > 1500)'], ['mlcin', -90, 'Capped (MLCIN −90 < −75)']])('blocks %s and skips it silently when absent', (key, value, reason) => {
        const d = fixture();
        d.sounding.value!.derived[key].value = Number(value);
        expect(model(d).verdict).toBe('CONDITIONAL');
        expect(model(d).reasons).toContain(reason);
        delete d.sounding.value!.derived[key];
        expect(model(d).verdict).toBe('GO');
    });
    it('blocks arrival 70 min after the window, accepts exactly 60', () => {
        const d = fixture();
        d.briefing.value!.items[0].model.target_points![0].valid_time = iso(NOW - 70 * 60000);
        expect(model(d).verdict).toBe('CONDITIONAL');
        expect(model(d).reasons.some(r => r.startsWith('Arrival '))).toBe(true);
        d.briefing.value!.items[0].model.target_points![0].valid_time = iso(NOW - 60 * 60000);
        expect(model(d).verdict).toBe('GO');
    });
    it('lists closer path numeric misses and tier failures', () => {
        const d = fixture();
        d.sounding.value!.derived.shear_0_6km.value = 32;
        d.potential.value!.features[0].properties.tier = 1;
        expect(model(d).reasons).toContain('Shear 32 kt < 35');
        expect(model(d).reasons).toContain('Tier 1 < 2');
    });
    it('STP is optional and only a bonus', () => {
        const d = fixture();
        expect(model(d).reasons).not.toContain('Sig-tor parameter favorable');
        d.sounding.value!.derived.stp = { ...d.sounding.value!.derived.mlcape, value: 1.2 };
        expect(model(d).reasons).toContain('Sig-tor parameter favorable');
        expect(model(d).verdict).toBe('GO');
    });
    it.each(['catalog', 'potential', 'briefing', 'sounding'] as const)('keeps failed %s values and blocks GO', (key) => {
        const d = fixture();
        d[key].failed = true;
        expect(model(d).verdict).not.toBe('GO');
        expect(d[key].value).not.toBeNull();
    });
    it.each(['mlcape', 'shear_0_6km', 'srh_0_1km_calc'])('makes missing %s unavailable', (key) => {
        const d = fixture();
        d.sounding.value!.derived[key].value = null;
        expect(model(d).inputs.sounding.state).toBe('UNAVAILABLE');
        expect(model(d).verdict).not.toBe('GO');
    });
    it('uses exact per-source freshness boundaries', () => {
        const d = fixture();
        d.catalog.value!.sources[0].checked_at = iso(NOW - 90 * 60000);
        d.potential.value!.generated_at = iso(NOW - 75 * 60000);
        d.sounding.value!.generated_at = iso(NOW - 3 * 3600000);
        d.briefing.value!.last_source_check_at = iso(NOW - 90 * 60000);
        expect(model(d).verdict).toBe('GO');
        expect(model(d, NOW + 1).verdict).toBe('INSUFFICIENT DATA');
        d.catalog.value!.cache_state = 'cached';
        expect(model(d).inputs.spc.state).toBe('STALE');
    });
    it('returns insufficient with missing briefing or two degraded sources', () => {
        const d = fixture();
        d.briefing.value!.items = [];
        expect(model(d).verdict).toBe('INSUFFICIENT DATA');
        const e = fixture();
        e.catalog.value = null;
        e.potential.value = null;
        expect(model(e).verdict).toBe('INSUFFICIENT DATA');
    });
    it('returns NO-GO for expired, weak, or no-area environments', () => {
        const d = fixture();
        d.briefing.value!.items[0].valid_until = iso(NOW - 1);
        expect(model(d).verdict).toBe('NO-GO');
        const e = fixture();
        e.sounding.value!.derived.mlcape.value = 240;
        e.sounding.value!.derived.shear_0_6km.value = 24;
        expect(model(e).verdict).toBe('NO-GO');
        const f = fixture();
        f.catalog.value!.records = [];
        f.potential.value!.features = [];
        delete f.briefing.value!.items[0].official.risk_code;
        expect(model(f).verdict).toBe('NO-GO');
    });
    it('blocks stale Fabric, missing positions and long drive', () => {
        expect(mergeChaseDay(fixture(), units, true, NOW).verdict).not.toBe('GO');
        expect(mergeChaseDay(fixture(), [], false, NOW).reasons).toContain('No usable chaser position');
        const far = [{ ...units[0], location: { latitude: 40, longitude: -115, observed_at: iso() } }];
        expect(mergeChaseDay(fixture(), far, false, NOW).reasons.some(r => r.includes('> 5h'))).toBe(true);
    });
    it('uses fix timestamps for live/last-known age and drops old fixes', () => {
        const u = structuredClone(units);
        u[0].location.observed_at = iso(NOW - 3 * 3600000);
        expect(chaserRows(u, targetPoint(briefing()), NOW)[0].state).toBe('LAST KNOWN');
        u[0].location.observed_at = iso(NOW - 7 * 3600000);
        expect(chaserRows(u, targetPoint(briefing()), NOW)[0].arrival).toBeNull();
    });
    it('counts down the target window', () => { expect(windowText(NOW + 3600000, NOW + 7200000, NOW)).toBe('Window starts in 1h 0m'); expect(windowText(NOW - 1, NOW + 3600000, NOW)).toContain('Window open'); });
});
it('preloads a target point only for finite coordinates without changing the default', () => {
    expect(parseSoundingPreload('')).toBeNull();
    expect(parseSoundingPreload('?lat=&lon=0')).toBeNull();
    expect(parseSoundingPreload('?lat=91&lon=0')).toBeNull();
    expect(parseSoundingPreload('?lat=NaN&lon=0')).toBeNull();
    expect(parseSoundingPreload('?lat=35&lon=-97&label=Target')).toEqual({ lat: 35, lon: -97, label: 'Target' });
});

it('handles SPC MultiPolygon target containment, outside targets and optional omissions',()=>{
 const d=fixture();const region=d.catalog.value!.records[0];region.geometry={type:'MultiPolygon',coordinates:[polygon]};expect(model(d).verdict).toBe('GO')
 delete d.sounding.value!.derived.mlcin;delete d.sounding.value!.derived.lcl_height;delete d.briefing.value!.items[0].official.risk_code;expect(model(d).verdict).toBe('GO')
 region.geometry.coordinates=[];expect(model(d).verdict).toBe('CONDITIONAL')
})
it('uses briefing valid_from only when the target lacks valid_time',()=>{
 const d=fixture();delete d.briefing.value!.items[0].model.target_points![0].valid_time
 expect(model(d).windowStart).toBe(Date.parse(d.briefing.value!.items[0].valid_from))
})
it('respects sounding validity and explicit source status independently of successful reads',()=>{
 const d=fixture();d.sounding.value!.valid_time=iso(NOW+3*3600000+1);expect(model(d).inputs.sounding.state).toBe('STALE')
 d.potential.value!.status='stale';expect(model(d).verdict).toBe('INSUFFICIENT DATA')
 const e=fixture();e.catalog.value!.sources[0].status='no_delineated_area';e.catalog.value!.records=[];e.potential.value!.features=[];delete e.briefing.value!.items[0].official.risk_code;expect(model(e).verdict).toBe('NO-GO')
})
