import { it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ChaseDayBriefingView } from './ChaseDayBriefingCard';
import { mergeChaseDay, emptyData, type DayData } from './chaseDayModel';
import { fixture, NOW, units } from './fixtures';
function render(data: DayData, fixes: unknown[] = units) { return renderToString(<MemoryRouter><ChaseDayBriefingView data={data} model={mergeChaseDay(data, fixes, false, NOW)} retry={() => { }}/></MemoryRouter>); }
it('renders GO, target tiles, confidence, public hold and authority footer', () => {
    const html = render(fixture());
    expect(html).toContain('data-verdict="GO"');
    expect(html).toContain('Sounding at target point');
    expect(html).toContain('Target area TBA');
    expect(html).toContain('Official NWS watches and warnings are authoritative.');
    expect(html).toContain('Screening summary, not a forecast.');
    expect(html).toContain('Higher');
    expect(html).toContain('checked=""');
});
it('renders loading per section and no-reviewed empty state', () => {
    const d = emptyData();
    d.catalog.loading = true;
    expect(render(d)).toContain('Checking SPC Day 1');
    expect(render(d)).toContain('No reviewed briefing for today');
    expect(render(d).replace(/<!-- -->/g, '')).toContain('Drafts awaiting review: 0');
});
it('renders unavailable as not an all-clear and stale with retained data', () => {
    expect(render(emptyData())).toContain('Not an all-clear.');
    const d = fixture();
    d.catalog.failed = true;
    const html = render(d);
    expect(html).toContain('STALE');
    expect(html).toContain('Retained snapshot');
    expect(html).not.toContain('data-verdict="GO"');
});
it('hides arrival estimates with no fix and renders missing sounding values as a dash', () => {
    const d = fixture();
    d.sounding.value!.derived.mlcape.value = null;
    const html = render(d, [{ unit_type: 'chase-platform', display_name: 'No fix' }]);
    expect(html).toContain('No usable position');
    expect(html).not.toContain('Est. arrival ');
    expect(html).toContain('—');
});
it('renders the Bunkers RM as provided, only when present', () => {
    const d = fixture();
    expect(render(d)).not.toContain('Approach hint:');
    d.sounding.value!.derived.bunkers_rm = { ...d.sounding.value!.derived.mlcape, value: '240/35', unit: 'kt' };
    expect(render(d)).toContain('240/35');
});
