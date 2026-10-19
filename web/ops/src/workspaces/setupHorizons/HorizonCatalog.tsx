import {useEffect,useMemo,useRef,useState} from 'react'
import {loadHorizonCatalog} from './horizonCatalogRead'
import {useCoreOps} from '../../core/useCoreOps'
// @ts-expect-error Existing JavaScript poller has no declaration file.
import {visibleSnapshotPoller} from '../../pages/visibleSnapshotPoller.mjs'
import {ErrorState} from '../../components/AsyncViewState'
import {OpsStatusPill} from '../../components/OpsStatusPill'
import {OutlookDayStrip} from './OutlookDayStrip'
import {OutlookMap} from './OutlookMap'
import {OutlookDetails,EvidenceHistory} from './OutlookDetails'
import {mapShape} from './outlookGeometry'
import {categoryOf} from './outlookCategory'
import {time,dayDate,snapshotStale,sourceStale,type Catalog} from './outlookModel'
import {SHARE_PRESETS} from './outlookShareConfig'
import {shareOutlook} from './outlookShareImage'
import {outlookVisibility} from './outlookVisibility'
import './horizons.css'
export type {Catalog} from './outlookModel'
const EMPTY_RECORDS:Catalog['records']=[]
export function HorizonCatalogView({catalog,error,onRefresh}:{catalog:Catalog|null;error:string|null;onRefresh:()=>void}){
 const [day,setDay]=useState(1),[selected,setSelected]=useState<string|null>(null),[coverage,setCoverage]=useState('conus'),[expanded,setExpanded]=useState(false),[origins,setOrigins]=useState({nick:'Topeka, KS',spencer:'Pea Ridge, AR'})
 const [presetIndex,setPresetIndex]=useState(0),[crop,setCrop]=useState('auto'),[sharing,setSharing]=useState(false),[shareError,setShareError]=useState<string|null>(null),[now,setNow]=useState(()=>Date.now())
 const expandButton=useRef<HTMLButtonElement>(null),section=useRef<HTMLElement>(null)
 useEffect(()=>{if(!expanded)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){setExpanded(false);expandButton.current?.focus()}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[expanded])
 useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden&&!section.current?.closest('[hidden]'))setNow(Date.now())},30000);return()=>clearInterval(timer)},[])
 const records=catalog?.records??EMPTY_RECORDS
 const rows=useMemo(()=>records.filter(r=>r.day===day).toSorted((a,b)=>categoryOf(a).rank-categoryOf(b).rank),[records,day])
 const shape=useMemo(()=>mapShape(coverage),[coverage])
 const regions=useMemo(()=>rows.map(row=>{const polygons=row.geometry.type==='Polygon'?[row.geometry.coordinates]:row.geometry.coordinates;return{row,d:shape.path(polygons),points:polygons.flat(2).map(shape.projectPoint)}}),[rows,shape])
 const source=catalog?.sources.find(s=>s.day===day),row=rows.find(r=>r.catalog_id===selected)??rows.at(-1),stale=snapshotStale(catalog,now)||sourceStale(source,now),fatal=!!error&&!catalog
 const share=async()=>{setSharing(true);setShareError(null);try{await shareOutlook({day,valid:dayDate(catalog,day),source,regions,states:shape.selected.map(s=>s.d),stale,minimumSpan:shape.minimumSpan,now},SHARE_PRESETS[presetIndex],crop==='auto'?undefined:crop==='zoom')}catch(e){setShareError(e instanceof Error?e.message:'Image unavailable. Refresh and retry.')}finally{setSharing(false)}}
 return <section ref={section} className="setup-horizons" aria-label="Setup Review outlook timeline" data-stale={stale}>
 <header className="setup-horizons__heading"><div><h2>Outlook timeline</h2><p>Official Days 1–8 · speculative Days 9–14 · this is not an all-clear</p>{catalog&&<small>Snapshot <time title={catalog.checked_at??undefined}>{time(catalog.checked_at)}</time> · revision {catalog.revision}</small>}</div><div className="outlook-actions"><button type="button" className="ops-button-primary outlook-share-primary" disabled={!catalog||sharing||coverage!=='conus'} onClick={()=>void share()}>{sharing?'Preparing image…':'Share image'}</button>{catalog&&<details className="outlook-share-options"><summary>Image options</summary><div><label>Image size <select value={presetIndex} onChange={e=>setPresetIndex(Number(e.target.value))}>{SHARE_PRESETS.map((preset,i)=><option key={preset.label} value={i}>{preset.label} · {preset.width}×{preset.height}{preset.primary?' · primary':''}</option>)}</select></label><label>Share crop <select value={crop} onChange={e=>setCrop(e.target.value)}><option value="auto">Full CONUS (link card: auto zoom)</option><option value="full">Full CONUS</option><option value="zoom">Zoom to risk areas</option></select></label></div></details>}<button type="button" title="Reload the saved outlook snapshot" onClick={onRefresh}>Refresh</button></div></header>
 {fatal?<ErrorState title="Saved outlook unavailable" message="Saved-source refresh failed. No replacement forecast is invented." onRetry={onRefresh}/>:<><div className="setup-horizons__notice" role="status">{stale&&<OpsStatusPill state="Stale"/>} {error?'Saved-source refresh failed; previous snapshot retained.':stale?'Saved snapshot needs a refresh.':catalog?'Saved outlook for operator review.':'Loading saved official-source catalog.'}<details><summary>Why / acquisition details</summary><p>{catalog?.acquisition_note}</p>{stale&&<p>Snapshot checked more than 90 minutes ago, has no verified check time, or was marked stale by its source. Day validity is checked separately; expired windows remain available for review.</p>}</details></div>
 <OutlookDayStrip catalog={catalog} day={day} now={now} onDay={value=>{setDay(value);setSelected(null)}}/>
</>}
 {shareError&&<ErrorState compact title="Image unavailable" message={shareError} onRetry={()=>void share()}/>}
 <div className="setup-horizons__grid" data-expanded={expanded}><OutlookMap day={day} valid={dayDate(catalog,day)} source={source} regions={regions} shape={shape} coverage={coverage} onCoverage={setCoverage} expanded={expanded} onExpand={()=>setExpanded(v=>!v)} expandButton={expandButton} selected={row?.catalog_id} onSelect={setSelected}/>{!fatal&&<OutlookDetails coverage={coverage} day={day} source={source} row={row} rows={rows} catalog={catalog} now={now} onSelect={setSelected}/>}</div>
 {expanded&&catalog&&catalog.revision>0&&<EvidenceHistory catalog={catalog}/>}
   <details className="setup-horizons__preferences"><summary>Planning origins — separate from live positions</summary><label>Nick origin town<input maxLength={80} value={origins.nick} onChange={e=>setOrigins({...origins,nick:e.target.value})}/></label><label>Spencer origin town<input maxLength={80} value={origins.spencer} onChange={e=>setOrigins({...origins,spencer:e.target.value})}/></label><button type="button" onClick={()=>setOrigins({nick:'Topeka, KS',spencer:'Pea Ridge, AR'})}>Reset town defaults</button><p>Nick: {origins.nick||'Choose a town'} · Spencer: {origins.spencer||'Choose a town'}. Session-local only; no location, route or precise coordinates sent. Departure, overnight and meetup remain unplanned.</p></details>

 </section>
}
export default function HorizonCatalog(){
 const {config}=useCoreOps(),[catalog,setCatalog]=useState<Catalog|null>(null),[error,setError]=useState<string|null>(null),refresh=useRef<(()=>void)|null>(null),host=useRef<HTMLDivElement>(null)
 useEffect(()=>{
 const visibility=outlookVisibility(document,host.current?.closest('[data-tab="outlook"]')??null)
 const paused=()=>host.current?.setAttribute('data-paused',String(visibility.hidden))
 visibility.addEventListener('visibilitychange',paused);paused()
 const poll=visibleSnapshotPoller({visibility,intervalMs:30000,load:(signal:AbortSignal)=>loadHorizonCatalog(config,signal),onData:(value:Catalog)=>{setCatalog(value);setError(null)},onError:()=>setError('UNAVAILABLE')})
 refresh.current=poll.refresh;return()=>{poll.stop();visibility.removeEventListener('visibilitychange',paused);visibility.stop();refresh.current=null}
 },[config])
 return <div ref={host} className="outlook-host"><HorizonCatalogView catalog={catalog} error={error} onRefresh={()=>refresh.current?.()}/></div>
}
