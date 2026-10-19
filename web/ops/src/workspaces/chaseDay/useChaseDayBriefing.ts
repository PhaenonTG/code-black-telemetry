import { useEffect, useRef, useState } from 'react';
import { fetchForecast, fetchSoundingPoint, retryOnceOnTransient, SOUNDING_REQUEST_TIMEOUT_MS } from '../../core/client';
import { coreConfigured, type OpsCoreConfig } from '../../core/config';
import { requestDeadline } from '../../core/requestDeadline';
import { useCoreOps } from '../../core/useCoreOps';
import { useSharedOpsStatus } from '../../core/useSharedOpsStatus';
import { loadHorizonCatalog } from '../setupHorizons/horizonCatalogRead';
import { parsePotential } from '../tornadoPotentialModel';
import { emptyData, selectBriefing, targetPoint, approved, timeMs, mergeChaseDay, type Briefing, type Briefings, type DayData, type Source } from './chaseDayModel';
type Index = {
    status: string;
    last_source_check_at?: string;
    items: Array<{
        setup_id: string;
    }>;
};
export function boundedRead<T>(read: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, timeout = 10000): Promise<T> {
    return retryOnceOnTransient(() => {
        if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
        return requestDeadline(read, timeout, signal);
    });
}
export function retainFailure<T>(source: Source<T>): Source<T> { return { ...source, loading: false, slow: false, failed: true }; }
/** The hook's lifecycle driver is independently testable in node; cleanup aborts all reads. */
export function startBriefingReads(config: OpsCoreConfig, onData: (data: DayData) => void, now = () => Date.now()) {
    let data = emptyData(), closed = false, soundingKey = '', soundingController: AbortController | null = null;
    const latest = new Map<keyof DayData, AbortController>();
    const controllers = new Set<AbortController>(), busy = new Set<keyof DayData>(), slowTimers = new Set<ReturnType<typeof setTimeout>>();
    const emit = () => { if (!closed)
        onData({ ...data }); };
    const update = <K extends keyof DayData>(key: K, source: DayData[K]) => { data = { ...data, [key]: source }; emit(); };
    const run = async <K extends keyof DayData>(key: K, read: (signal: AbortSignal) => Promise<NonNullable<DayData[K]['value']>>, timeout = 20250) => {
        if (closed || busy.has(key))
            return;
        busy.add(key);
        const controller = new AbortController();
        controllers.add(controller);
        latest.set(key, controller);
        if (key === 'sounding')
            soundingController = controller;
        update(key, { ...data[key], loading: true, slow: false });
        const slow = setTimeout(() => { if (!closed && !controller.signal.aborted)
            update(key, { ...data[key], slow: true, failed: key === 'sounding' ? data[key].failed : true, loading: key === 'sounding' }); }, 10000);
        slowTimers.add(slow);
        try {
            const value = await requestDeadline(read, timeout, controller.signal);
            if (!closed && !controller.signal.aborted)
                update(key, { value, loading: false, failed: false, slow: false } as DayData[K]);
        }
        catch {
            if (!closed && !controller.signal.aborted)
                update(key, { ...data[key], loading: false, slow: false, failed: true });
        }
        finally {
            clearTimeout(slow);
            slowTimers.delete(slow);
            controllers.delete(controller);
            if (latest.get(key) === controller)
                busy.delete(key);
        }
    };
    const sounding = () => {
        const b = selectBriefing(data.briefing.value?.items ?? [], now()), target = targetPoint(b);
        const key = target ? `${b?.setup_id}:${b?.revision}:${target.key}` : '';
        if (key !== soundingKey) {
            soundingController?.abort();
            busy.delete('sounding');
            soundingKey = key;
            update('sounding', { value: null });
        }
        if (!target || closed)
            return;
        void run('sounding', signal => boundedRead(s => fetchSoundingPoint(config, { lat: target.latitude, lon: target.longitude }, undefined, s), signal, SOUNDING_REQUEST_TIMEOUT_MS), SOUNDING_REQUEST_TIMEOUT_MS);
    };
    const refresh = () => {
        if (closed || !coreConfigured(config))
            return;
        void run('catalog', signal => boundedRead(s => loadHorizonCatalog(config, s), signal));
        void run('potential', async (signal) => {
            let value = parsePotential(await boundedRead(s => fetchForecast(config, 'tornado-potential', s), signal));
            const frame = [...value.frames].sort((a, b) => Math.abs(timeMs(a.valid_time) - now()) - Math.abs(timeMs(b.valid_time) - now()))[0];
            if (frame && frame.frame_id !== value.frame_id)
                value = parsePotential(await boundedRead(s => fetchForecast(config, `tornado-potential?frame=${encodeURIComponent(frame.frame_id)}`, s), signal));
            return value;
        });
        void run('briefing', async (signal) => {
            const index = await boundedRead(s => fetchForecast<Index>(config, 'chase-setups', s), signal);
            if (!Array.isArray(index.items))
                throw Error('Invalid briefing index');
            const items = await Promise.all(index.items.filter(row => /^setup-\d{8}-[0-9a-f]{10}$/.test(row.setup_id)).map(async (row) => {
                const detail = await boundedRead(s => fetchForecast<Briefing>(config, `chase-setup?setup_id=${encodeURIComponent(row.setup_id)}`, s), signal);
                if (!detail || detail.setup_id !== row.setup_id || !detail.official || !detail.model || !Array.isArray(detail.model.target_points))
                    throw Error('Invalid briefing detail');
                return detail;
            }));
            return { status: index.status, last_source_check_at: index.last_source_check_at, items, drafts: items.filter(b => !approved(b)).length } satisfies Briefings;
        }).then(() => { if (!closed)
            sounding(); });
    };
    refresh();
    return { refresh, stop: () => { closed = true; controllers.forEach(c => c.abort()); slowTimers.forEach(clearTimeout); } };
}
export function useChaseDayBriefing() {
    const { config } = useCoreOps(), shared = useSharedOpsStatus();
    const [packet, setPacket] = useState<{
        config: OpsCoreConfig;
        data: DayData;
    } | null>(null), [now, setNow] = useState(Date.now);
    const refresh = useRef<() => void>(() => { });
    useEffect(() => {
        const reads = startBriefingReads(config, data => setPacket({ config, data }));
        refresh.current = reads.refresh;
        const timer = setInterval(() => { setNow(Date.now()); reads.refresh(); }, 60000);
        return () => { clearInterval(timer); reads.stop(); };
    }, [config]);
    const data = packet?.config === config ? packet.data : emptyData();
    return { data, model: mergeChaseDay(data, shared.fabric.units?.units ?? [], shared.fabric.state !== 'LIVE', now), retry: () => refresh.current() };
}
