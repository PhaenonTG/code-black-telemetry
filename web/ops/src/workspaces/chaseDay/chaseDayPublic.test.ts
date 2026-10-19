import { it, expect } from 'vitest';
import { publicText } from './chaseDayPublic';
import { NOW } from './fixtures';
const b = { date: NOW, category: 'SLGT', place: 'Oklahoma City', start: NOW, end: NOW + 3600000 };
it('defaults to TBA, reveals only the place on toggle and always ends with the footer', () => {
    expect(publicText(b)).toContain('Target area TBA');
    expect(publicText(b)).not.toContain(b.place);
    expect(publicText(b, false)).toContain(b.place);
    expect(publicText({ ...b, place: null }, false)).toContain('Target area TBA');
    for (const hold of [true, false]) {
        const t = publicText(b, hold);
        expect(t).not.toMatch(/\d+\.\d{2,}|Private Chaser|private-unit|setup-|miles|arrival|score|Aegis/i);
        expect(t.endsWith('Screening summary, not a forecast.')).toBe(true);
    }
});
it('rejects coordinates and injected lines in place names', () => { expect(publicText({ ...b, place: '35.12, -97.12' }, false)).toContain('Target area TBA'); expect(publicText({ ...b, place: 'City\nPrivate Chaser' }, false)).toContain('Target area TBA'); });
it('public snapshot', () => {
    expect(publicText(b)).toMatchInlineSnapshot(`"May 15, 2026
SPC Day 1: SLGT · https://www.spc.noaa.gov/
Target area TBA
Valid window: 1:00 PM CT – 2:00 PM CT
Official NWS watches and warnings are authoritative.
Screening summary, not a forecast."`);
});
