import {OpsStatusPill} from '../../components/OpsStatusPill'
import {categoryOf,categoryLabel} from './outlookCategory'
import {contentState,time,clock,date,originalSource,sourceReason,sourceLink,type Source,type Region,type Catalog} from './outlookModel'
export function EvidenceHistory({catalog}:{catalog:Catalog}){
 return <details className="outlook-evidence"><summary title="Evidence history">rev {catalog.revision} · Evidence history</summary>{catalog.history.slice(-8).map(event=><p key={event.revision}><time title={event.at}>{time(event.at)}</time> · revision {event.revision}: {event.added.length} added, {event.changed.length} changed, {event.removed.length} removed.</p>)}<ul>{catalog.sources.filter(s=>sourceLink(s.source_url)).map(s=><li key={s.day}><a href={sourceLink(s.source_url)!} target="_blank" rel="noopener noreferrer">Day {s.day} raw source evidence</a></li>)}</ul>{catalog.records.filter(r=>sourceLink(r.source_url)).map(r=><p key={r.catalog_id}><a href={sourceLink(r.source_url)!} target="_blank" rel="noopener noreferrer">{r.label} · source evidence</a></p>)}</details>
}
export function OutlookDetails({day,source,row,rows,catalog,onSelect,now,coverage='conus'}:{day:number;source?:Source;row?:Region;rows:Region[];catalog:Catalog|null;onSelect:(id:string)=>void;now:number;coverage?:string}){
 const state=coverage==='conus'?contentState(source,row,now):'No coverage',href=day<=8?originalSource(day):sourceLink(row?.source_url??source?.source_url)
 const stamp=(v?:string,window=false)=><time title={v}>{window&&v?`${date(v)} · ${clock(v)}`:time(v)}</time>
 return <aside className="setup-horizons__source" aria-label="Selected source details"><OpsStatusPill state={state}/><h3>{row?categoryLabel(row):day>=9?'No pattern forecast supplied':'No verified outlook area'}</h3>
 <p className="outlook-valid-window">{source?.valid_from||row?.valid_from?<>Valid {stamp(row?.valid_from??source?.valid_from,true)} – {stamp(row?.valid_until??source?.valid_until,true)}</>:'Valid window unavailable'}</p>
 {state==='Expired'&&<p>Valid window ended {clock(row?.valid_until??source?.valid_until)}. Kept for review; refresh for the new issuance.</p>}
 {row&&<p>{categoryOf(row).key==='tstm'?'General thunderstorm guidance; not a severe/tornado or chase-target claim.':row.uncertainty}</p>}
 <dl><dt>Source</dt><dd>{row?.source??(day<=8?'Expected source: NOAA SPC (unavailable)':'Ensemble mean/spread inputs required')}</dd><dt>Issued / model run</dt><dd>{stamp(row?.issued_at??source?.issued_at)}</dd><dt>Valid window</dt><dd>{stamp(row?.valid_from??source?.valid_from,true)} – {stamp(row?.valid_until??source?.valid_until,true)}</dd><dt>Source checked</dt><dd>{stamp(source?.checked_at)}</dd><dt>Retained data state</dt><dd>{row?.data_status??'No observed record'}</dd></dl>
 {source?.reason&&<p>{sourceReason(source.reason,day)}</p>}{href&&<a href={href} target="_blank" rel="noopener noreferrer">Open original source ↗</a>}
 {!!rows.length&&<div role="group" aria-label="Outlook areas">{rows.map(r=><button key={r.catalog_id} type="button" data-cat={categoryOf(r).key} aria-pressed={r.catalog_id===row?.catalog_id} onClick={()=>onSelect(r.catalog_id)}>{r.label}</button>)}</div>}
 {catalog&&catalog.revision>0&&<EvidenceHistory catalog={catalog}/>}
 </aside>
}
