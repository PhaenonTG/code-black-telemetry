import { afterEach, it, expect, vi } from 'vitest';
import { boundedRead, startBriefingReads, retainFailure } from './useChaseDayBriefing';
import { readOpsCoreConfig } from '../../core/config';
import { fixture, briefing, NOW, iso } from './fixtures';
import type { DayData } from './chaseDayModel';
const mocks = vi.hoisted(() => ({ forecast: vi.fn(), sounding: vi.fn() }));
vi.mock('../../core/client', async (importOriginal) => ({ ...await importOriginal<typeof import('../../core/client')>(), fetchForecast: (...args: unknown[]) => mocks.forecast(...args), fetchSoundingPoint: (...args: unknown[]) => mocks.sounding(...args) }));
const config = readOpsCoreConfig({ VITE_CODEBLACK_CORE_BASE_URL: 'http://fixture.invalid' });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('aborts each hung attempt at ten seconds and permits only one retry', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const promise = boundedRead(s => { signals.push(s); return new Promise(() => {}); }, new AbortController().signal);
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10250);
    await assertion;
    expect(signals).toHaveLength(2);
    expect(signals.every(s=>s.aborted)).toBe(true);
});
it('retries a transient 502 exactly once', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValueOnce(Error('HTTP 502')).mockResolvedValue('ok');
    const result = boundedRead(read, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(250);
    expect(await result).toBe('ok');
    expect(read).toHaveBeenCalledTimes(2);
});
it('does not read when Core is unconfigured', () => {
    const reads = startBriefingReads(readOpsCoreConfig({}), () => { });
    reads.refresh();
    reads.stop();
    expect(mocks.forecast).not.toHaveBeenCalled();
});
it('cleanup aborts pending reads and suppresses updates after unmount', async () => {
    vi.useFakeTimers();
    mocks.forecast.mockImplementation(() => new Promise(() => { }));
    const update = vi.fn();
    const reads = startBriefingReads(config, update, () => NOW);
    await Promise.resolve();
    reads.stop();
    const count = update.mock.calls.length;
    await vi.advanceTimersByTimeAsync(80000);
    expect(update).toHaveBeenCalledTimes(count);
    expect(mocks.forecast.mock.calls.every(c => c[2].aborted)).toBe(true);
});
it('retains last good and marks stale after refresh failure', async () => {
    vi.useFakeTimers();
    const d = fixture();
    let fail = false;
    let data: DayData | undefined;
    mocks.forecast.mockImplementation((_c, endpoint) => {
        if (fail)
            return Promise.reject(Error('Unavailable'));
        if (endpoint === 'chase-horizons')
            return Promise.resolve(d.catalog.value);
        if (endpoint === 'tornado-potential')
            return Promise.resolve(d.potential.value);
        if (endpoint === 'chase-setups')
            return Promise.resolve({ status: 'ready', last_source_check_at: iso(), items: [{ setup_id: briefing().setup_id }] });
        return Promise.resolve(briefing());
    });
    mocks.sounding.mockResolvedValue(d.sounding.value);
    const reads = startBriefingReads(config, d => { data = d; }, () => NOW);
    await vi.advanceTimersByTimeAsync(1);
    expect(data?.sounding.value).not.toBeNull();
    fail = true;
    reads.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(data?.catalog.value).toEqual(d.catalog.value);
    expect(data?.catalog.failed).toBe(true);
    reads.stop();
    expect(retainFailure({ value: 123 })).toMatchObject({ value: 123, failed: true, loading: false });
});
it('marks sounding slow at ten seconds while allowing its single background read', async () => {
    vi.useFakeTimers();
    const d = fixture();
    let data: DayData | undefined;
    mocks.forecast.mockImplementation((_c, e) => Promise.resolve(e === 'chase-horizons' ? d.catalog.value : e === 'tornado-potential' ? d.potential.value : e === 'chase-setups' ? { status: 'ready', last_source_check_at: iso(), items: [{ setup_id: briefing().setup_id }] } : briefing()));
    mocks.sounding.mockImplementation(() => new Promise(() => { }));
    const reads = startBriefingReads(config, d => { data = d; }, () => NOW);
    await vi.advanceTimersByTimeAsync(10001);
    expect(data?.sounding.slow).toBe(true);
    expect(data?.sounding.loading).toBe(true);
    expect(mocks.sounding).toHaveBeenCalledTimes(1);
    expect(data?.catalog.value).not.toBeNull();
    await vi.advanceTimersByTimeAsync(65000);
    expect(data?.sounding.failed).toBe(true);
    reads.stop();
});

it('ends Checking at ten seconds for a hung non-sounding source while retrying',async()=>{
 vi.useFakeTimers();mocks.forecast.mockImplementation(()=>new Promise(()=>{}));let data:DayData|undefined
 const reads=startBriefingReads(config,d=>{data=d},()=>NOW)
 await vi.advanceTimersByTimeAsync(10000);expect(data?.catalog).toMatchObject({loading:false,failed:true,slow:true});expect(data?.potential).toMatchObject({loading:false,failed:true,slow:true})
 await vi.advanceTimersByTimeAsync(10250);expect(data?.catalog.failed).toBe(true);expect(mocks.forecast.mock.calls.filter(c=>c[1]==='chase-horizons')).toHaveLength(2);reads.stop()
})

it('aborts and clears the previous target sounding when the approved revision changes',async()=>{
 vi.useFakeTimers();const d=fixture();let b=briefing();let data:DayData|undefined
 mocks.forecast.mockImplementation((_c,e)=>Promise.resolve(e==='chase-horizons'?d.catalog.value:e==='tornado-potential'?d.potential.value:e==='chase-setups'?{status:'ready',last_source_check_at:iso(),items:[{setup_id:b.setup_id}]}:b))
 mocks.sounding.mockImplementation(()=>new Promise(()=>{}))
 const reads=startBriefingReads(config,d=>{data=d},()=>NOW);await vi.advanceTimersByTimeAsync(1)
 const oldSignal=mocks.sounding.mock.calls[0][3]
 b={...briefing(),revision:3,model:{target_points:[{latitude:36,longitude:-96,score_index:0.9,valid_time:iso()}]}}
 reads.refresh();await vi.advanceTimersByTimeAsync(1)
 expect(oldSignal.aborted).toBe(true);expect(mocks.sounding).toHaveBeenCalledTimes(2);expect(mocks.sounding.mock.calls[1][1]).toEqual({lat:36,lon:-96});expect(data?.sounding.value).toBeNull();reads.stop()
})
