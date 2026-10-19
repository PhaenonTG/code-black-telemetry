import { afterEach, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AnalysisWorkspace from '../../pages/AnalysisWorkspace';
vi.mock('../../pages/ChaseSetups', () => ({ default: () => null }));
vi.mock('../../pages/ChaseSurveillance', () => ({ default: () => null }));
vi.mock('../../pages/TornadoPotential', () => ({ default: () => null }));
vi.mock('../setupHorizons/HorizonCatalog', () => ({ default: () => null }));
vi.mock('./ChaseDayBriefingCard', () => ({ default: () => null }));
afterEach(() => vi.unstubAllGlobals());
function render(path: string) { return renderToString(<MemoryRouter initialEntries={[path]}><AnalysisWorkspace /></MemoryRouter>); }
it('uses the existing analysis route and puts Chase day first for mode=today', () => {
    const html = render('/analysis?mode=today');
    expect(html).toContain('aria-pressed="true">Chase day');
    expect(html.indexOf('>Chase day</button>')).toBeLessThan(html.indexOf('>Outlook timeline</button>'));
    expect(html).toContain('Private chase day screening briefing');
});
it('preserves outlooks as the default and accepts today in saved preferences', () => {
    expect(render('/analysis')).toContain('aria-pressed="true">Outlook timeline');
    vi.stubGlobal('localStorage', { getItem: () => 'today' });
    expect(render('/analysis')).toContain('aria-pressed="true">Chase day');
});
it('keeps explicit routes ahead of the saved mode', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'today' });
    expect(render('/analysis/potential')).toContain('aria-pressed="true">Tornado potential');
});
