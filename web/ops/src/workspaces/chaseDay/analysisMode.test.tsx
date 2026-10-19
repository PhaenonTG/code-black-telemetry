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
it('puts Today first and marks its path as current', () => {
    const html = render('/setup-review/today');
    expect(html).toMatch(/aria-current="page"[^>]*>Today<\/a>/);
    expect(html.indexOf('>Today</a>')).toBeLessThan(html.indexOf('>Outlook</a>'));
    expect(html).toContain('Forecast setups from outlook to briefing');
});
it('ignores saved device preferences and uses the explicit Outlook path', () => {
    expect(render('/setup-review/outlook')).toMatch(/aria-current="page"[^>]*>Outlook<\/a>/);
    vi.stubGlobal('localStorage', { getItem: () => 'today' });
    expect(render('/setup-review/outlook')).toMatch(/aria-current="page"[^>]*>Outlook<\/a>/);
});
it('keeps explicit routes ahead of the saved mode', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'today' });
    expect(render('/setup-review/potential')).toMatch(/aria-current="page"[^>]*>Potential<\/a>/);
});
