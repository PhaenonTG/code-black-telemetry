import type { SoundingPointResult } from '../../core/types';
import type { Catalog } from '../setupHorizons/HorizonCatalog';
import type { Briefing, DayData } from './chaseDayModel';
export const NOW = Date.parse('2026-05-15T18:00:00Z');
export const iso = (ms = NOW) => new Date(ms).toISOString();
export const polygon = [[[-100, 30], [-90, 30], [-90, 40], [-100, 40], [-100, 30]]];
export function briefing(): Briefing { return { setup_id: 'setup-20260515-abcdef0123', revision: 2, generated_at: iso(), valid_from: iso(NOW - 3600000), valid_until: iso(NOW + 8 * 3600000), official: { day: 1, risk_label: 'Slight', risk_code: 5 }, workflow: { decision: { decision: 'approved' } }, model: { target_points: [{ latitude: 35, longitude: -97, score_index: 0.8, valid_time: iso(NOW + 3600000) }] } }; }
export function sounding(): SoundingPointResult { return { location: { name: 'Oklahoma City', latitude: 35, longitude: -97 }, model: 'HRRR', run_time: iso(), forecast_hour: 0, valid_time: iso().replace('T', ' '), generated_at: iso(), profile: { pressure_hpa: [], height_m: [], temp_c: [], dewp_c: [], u_ms: [], v_ms: [], parcel_temp_c: null }, hodograph_points: [], derived: Object.fromEntries(Object.entries({ mlcape: 1500, shear_0_6km: 40, srh_0_1km_calc: 150, mlcin: -50, lcl_height: 1000 }).map(([k, v]) => [k, { label: k, value: v, unit: k === 'shear_0_6km' ? 'kt' : k === 'lcl_height' ? 'm' : '', provenance: 'source', note: null }])) }; }
export function fixture(): DayData {
    return {
        catalog: { value: { schema: 'codeblack.chase.horizon-catalog.v1', checked_at: iso(), revision: 1, cache_state: 'live', acquisition_note: '', history: [], sources: [{ day: 1, status: 'available', checked_at: iso() }], records: [{ catalog_id: 'cat', day: 1, kind: 'categorical', label: 'SLGT', official_code: 4, source: 'SPC', source_url: '', issued_at: iso(), valid_from: iso(NOW - 3600000), valid_until: iso(NOW + 8 * 3600000), data_status: 'available', uncertainty: '', geometry: { type: 'Polygon', coordinates: polygon } }] } satisfies Catalog },
        potential: { value: { schema: 'codeblack.tornado-potential.v1', status: 'ready', type: 'FeatureCollection', frames: [], generated_at: iso(), notice: '', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: polygon }, properties: { tier: 2, label: 'Tier 2', storm_supported: true, index_mean: 1, index_max: 1, native_land_points: 1 } }] } },
        briefing: { value: { status: 'ready', last_source_check_at: iso(), items: [briefing()], drafts: 0 } }, sounding: { value: sounding() }
    };
}
export const units = [{ unit_id: 'private-unit', display_name: 'Private Chaser', unit_type: 'chase-platform', location: { latitude: 35, longitude: -97, observed_at: iso() } }];
