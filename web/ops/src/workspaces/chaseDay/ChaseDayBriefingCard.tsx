import { formatOpsTimestamp } from "../../core/timeFormat";
import { SetupReviewTitle } from '../../pages/SetupReviewTitle';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { OpsStatusPill } from '../../components/OpsStatusPill';
import { AsyncViewState } from '../../components/AsyncViewState';
import { Hodograph } from '../../components/Hodograph';
import { useChaseDayBriefing } from './useChaseDayBriefing';
import { clock, duration, timeMs, windowText, type DayData, type DayModel } from './chaseDayModel';
import { daylightLeftMs } from './solar';
import { publicText } from './chaseDayPublic';
import './chaseDayBriefing.css';
export function ChaseDayBriefingView({ data, model: m, retry }: {
    data: DayData;
    model: DayModel;
    retry: () => void;
}) {
    const [holdArea, setHoldArea] = useState(true), [delivery, setDelivery] = useState('');
    const text = publicText({ date: m.now, category: m.spc, place: data.sounding.value?.location.name, start: m.windowStart, end: timeMs(m.b?.valid_until) }, holdArea);
    const download = () => { const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'chase-day.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setDelivery('Downloaded public text'); };
    const copy = async () => { try {
        await navigator.clipboard.writeText(text);
        setDelivery('Copied public text');
    }
    catch {
        setDelivery('Copy unavailable. Select the preview text or download it.');
    } };
    const publicSection = <><label><input type="checkbox" checked={holdArea} onChange={e => setHoldArea(e.target.checked)}/> Hold target area (TBA)</label><pre>{text}</pre><div className="cd-actions"><button type="button" onClick={() => void copy()}>Copy</button><button type="button" onClick={download}>Download .txt</button></div><p role="status">{delivery}</p></>;
    const confidence = m.target ? m.target.score_index >= 0.7 ? 'Higher' : m.target.score_index >= 0.4 ? 'Moderate' : 'Limited' : 'Not calculated';
    const soundingHref = m.target ? `/soundings?${new URLSearchParams({ lat: String(m.target.latitude), lon: String(m.target.longitude), label: data.sounding.value?.location.name ?? 'Chase day target' })}` : '/soundings';
    const bunkers = data.sounding.value?.derived.bunkers_rm;
    const sourceRows = [
        { key: 'spc' as const, label: 'SPC Day 1', source: data.catalog, href: '/setup-review/outlook' },
        { key: 'potential' as const, label: 'Tornado potential', source: data.potential, href: '/setup-review/potential' },
        { key: 'briefing' as const, label: 'Reviewed briefing', source: data.briefing, href: m.b ? `/setup-review/briefings/${m.b.setup_id}` : '/setup-review/briefings' },
        { key: 'sounding' as const, label: 'Sounding', source: data.sounding, href: soundingHref },
    ];
    return <article className="chase-day-briefing" aria-label="Private chase day briefing">
 <SetupReviewTitle title="Today" description="Private operational briefing · official guidance first · operator review required."
   state={Object.values(m.inputs).some(input => input.state === 'UNAVAILABLE') ? 'Unavailable' : Object.values(m.inputs).some(input => input.state === 'STALE') ? 'Stale' : Object.values(m.inputs).some(input => input.state === 'CHECKING') ? 'Waiting' : 'Live'}
   checkedAt={data.briefing.value?.last_source_check_at} busy={Object.values(data).some(source => source.loading)} refresh={retry} reloads="chase day sources" />
 <div className="cd-grid"><section className="cd-main">
 <div className="cd-verdict" data-verdict={m.verdict} role="status"><strong>{m.verdict}</strong><ul>{m.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>
 <section className="cd-target"><h3>{m.b?.official.risk_label ?? 'No reviewed briefing for today'}</h3>
 {!m.b && <p><Link to="/setup-review/drafts">Drafts awaiting review: {data.briefing.value?.drafts ?? 0} →</Link></p>}
 {m.target && <p>Rank 1 candidate · {m.target.latitude.toFixed(2)}, {m.target.longitude.toFixed(2)} · {data.sounding.value?.location.name ?? 'Target point'} · Target confidence: {confidence}</p>}
 <p>{windowText(m.windowStart, timeMs(m.b?.valid_until), m.now)}</p><p>Sunset {m.sunset ? clock(+m.sunset) : '—'} · {duration(daylightLeftMs(m.now, m.sunset))} daylight left</p></section>
 <div className="cd-tiles">
 <section><h3>SPC Day 1</h3><strong>{m.spc}</strong>{m.probability !== null && <p>Tornado {m.probability}%</p>}</section>
 <section><h3>Tornado potential</h3><strong>Tier {m.tier ?? '—'}</strong></section>
 <section><h3>Sounding at target point</h3><dl>{[['MLCAPE', m.cape, 'J/kg'], ['MLCIN', m.cin, 'J/kg'], ['LCL', m.lcl, 'm'], ['0–6 km shear', m.shear, 'kt'], ['0–1 km SRH', m.srh, 'm²/s²']].filter(([label, value]) => value !== null || !['MLCIN', 'LCL'].includes(String(label))).map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{value === null ? '—' : `${Math.round(Number(value))} ${unit}`}</dd></div>)}</dl>{bunkers?.value !== null && bunkers?.value !== undefined && <p>Approach hint: storm motion (Bunkers RM) {bunkers.value} {bunkers.unit}</p>}<Link to={soundingHref}>Open full sounding</Link></section>
 <section><h3>Briefing revision</h3><strong>{m.b ? `Revision ${m.b.revision}` : '—'}</strong><p title={m.b?.generated_at}>Generated {m.b ? clock(timeMs(m.b.generated_at)) : '—'}</p><p title={m.b?.official.issued_at}>SPC issued {m.b ? clock(timeMs(m.b.official.issued_at)) : '—'}</p><p title={m.target?.run_time}>HRRR run {clock(timeMs(m.target?.run_time))}</p></section>
 </div></section>
 <aside className="cd-side"><section className="cd-chasers"><h3>Chaser estimates</h3><OpsStatusPill state={m.inputs.fabric.state}/><p>Straight-line distance · est. drive = miles × 1.25 / 55 mph, rounded to 5 min.</p>
 {!m.chasers.length && <p>No usable position</p>}<div className="cd-chaser-head" aria-hidden="true"><span>Name / position age</span><span>Straight-line</span><span>Est. drive / arrival</span></div>
 {m.chasers.map((c, i) => <div className="cd-chaser-row" key={i}><div><strong>{c.name}</strong><p>{c.state} · {duration(c.ageMs)} old</p></div><span>{c.miles === null ? 'No usable position' : `${Math.round(c.miles)} straight-line mi`}</span>{c.arrival !== null && <span>Est. drive {duration(c.driveMs)}<br />Est. arrival {clock(c.arrival)}</span>}</div>)}</section>
 <section className="cd-hodo"><h3>Target hodograph</h3>{data.sounding.value?.hodograph_points.length ? <Hodograph points={data.sounding.value.hodograph_points}/> : <p>Hodograph unavailable</p>}</section>
 <section className="cd-public-desktop"><h3>Public-safe preview</h3>{publicSection}</section>
 <details className="cd-public-phone"><summary>Public-safe preview</summary>{publicSection}</details></aside></div>
 <div className="cd-sources" aria-label="Source freshness">{sourceRows.map(({ key, label, source, href }) => <section key={key}><h3>{label}</h3><OpsStatusPill state={m.inputs[key].state}/>{key !== 'briefing' && <p>{m.inputs[key].ageMs === null ? 'Age unavailable' : <time dateTime={new Date(m.now - m.inputs[key].ageMs).toISOString()} title={new Date(m.now - m.inputs[key].ageMs).toISOString()}>Checked {formatOpsTimestamp(m.now - m.inputs[key].ageMs, m.now)}</time>}</p>}
 {source.loading && !source.slow && !source.value && <AsyncViewState compact state="loading" title={`Checking ${label}…`}/>}
 {source.slow && <p role="status">Core slow (cold start?) · retrying{key === 'sounding' ? ' · background sounding read' : ''}</p>}
 {m.inputs[key].state === 'UNAVAILABLE' && <AsyncViewState compact state="error" title={`${label} unavailable. Not an all-clear.`} onRetry={retry}/>}
 {m.inputs[key].state === 'STALE' && <p>Retained snapshot · not current.</p>}<Link to={href}>Open {label}</Link></section>)}</div>
 <footer>Screening summary, not a forecast. Official NWS watches and warnings are authoritative.</footer>
 </article>;
}
export default function ChaseDayBriefingCard() { return <ChaseDayBriefingView {...useChaseDayBriefing()}/>; }
