import {useEffect,useRef,useState} from 'react'
import {loadHorizonCatalog} from './horizonCatalogRead'
import {useCoreOps} from '../../core/useCoreOps'
// @ts-expect-error Existing JavaScript poller has no declaration file.
import {visibleSnapshotPoller} from '../../pages/visibleSnapshotPoller.mjs'
import topology from './us-states.topo.json'
import './horizons.css'

type Source={day:number;status:string;reason?:string;source_url?:string;issued_at?:string;valid_from?:string;valid_until?:string;checked_at?:string;last_success_at?:string}
type Region={catalog_id:string;day:number;kind:string;label:string;official_code?:number;source:string;source_url:string;issued_at:string;valid_from:string;valid_until:string;data_status:string;uncertainty:string;geometry:{type:'Polygon'|'MultiPolygon';coordinates:any[]}}
export type Catalog={schema:string;checked_at:string|null;revision:number;cache_state:string;acquisition_note:string;records:Region[];sources:Source[];history:Array<{at:string;revision:number;added:string[];changed:string[];removed:string[]}>}
const time=(v?:string|null)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('en-US',{timeZone:'UTC'})+' UTC':'Not supplied'
const date=(v?:string)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'}):'Window unknown'
const label=(s?:string)=>({available:'Available',no_delineated_area:'No delineated area',insufficient_input:'Withheld — insufficient inputs',unavailable:'Unavailable',stale:'Stale'}[s??'']??'Unknown')
const sourceLink=(v?:string)=>{try{const u=new URL(v??'');return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
// Pinned ISC us-atlas boundaries; same Albers equal-area projection as reviewed slice.
function arc(index:number){let x=0,y=0;const rows=(topology.arcs[index<0?~index:index] as number[][]).map(([dx,dy])=>{x+=dx;y+=dy;return[x*topology.transform.scale[0]+topology.transform.translate[0],y*topology.transform.scale[1]+topology.transform.translate[1]]});return index<0?rows.reverse():rows}
const states=(topology.objects.states.geometries as any[]).map(g=>({id:Number(g.id),name:g.properties.name,polygons:(g.type==='Polygon'?[g.arcs]:g.arcs).map((p:number[][])=>p.map(ids=>ids.flatMap((id,i)=>arc(id).slice(i?1:0))))}))
const rad=Math.PI/180,n=(Math.sin(29.5*rad)+Math.sin(45.5*rad))/2,c=Math.cos(29.5*rad)**2+2*n*Math.sin(29.5*rad),rho0=Math.sqrt(c-2*n*Math.sin(38*rad))/n
function raw([lon,lat]:number[]){const rho=Math.sqrt(c-2*n*Math.sin(lat*rad))/n,theta=n*(lon+96)*rad;return[rho*Math.sin(theta),-(rho0-rho*Math.cos(theta))]}
function mapShape(coverage:string){
 const selected=states.filter(s=>coverage==='alaska'?s.name==='Alaska':coverage==='hawaii'?s.name==='Hawaii':s.id<=56&&![2,15].includes(s.id))
 const project=coverage==='conus'?raw:([lon,lat]:number[])=>[lon>0?lon-360:lon,-lat]
 const points=selected.flatMap(s=>s.polygons.flat(2).map(project)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),scale=Math.min(900/(maxX-minX),460/(maxY-minY))
 const path=(polygons:any[])=>polygons.map(p=>p.map((ring:number[][])=>ring.map((point,i)=>{const[x,y]=project(point);return`${i?'L':'M'}${(500+(x-(minX+maxX)/2)*scale).toFixed(2)},${(300+(y-(minY+maxY)/2)*scale).toFixed(2)}`}).join('')+'Z').join('')).join('')
 return {selected,path}
}
export function HorizonCatalogView({catalog,error,onRefresh}:{catalog:Catalog|null;error:string|null;onRefresh:()=>void}){
 const [day,setDay]=useState(1),[selected,setSelected]=useState<string|null>(null),[coverage,setCoverage]=useState('conus'),[expanded,setExpanded]=useState(false),[origins,setOrigins]=useState({nick:'Topeka, KS',spencer:'Pea Ridge, AR'})
 const expandButton=useRef<HTMLButtonElement>(null)
 useEffect(()=>{if(!expanded)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape'){setExpanded(false);expandButton.current?.focus()}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[expanded])
 const source=catalog?.sources.find(s=>s.day===day),rows=catalog?.records.filter(r=>r.day===day)??[],row=rows.find(r=>r.catalog_id===selected)??rows[0],shape=mapShape(coverage),href=sourceLink(row?.source_url??source?.source_url)
 return <section className="setup-horizons" aria-label="Setup Review outlook timeline">
  <header className="setup-horizons__heading"><div><h2>Outlook timeline</h2><p>Official Days 1–8 · separately labeled speculative Days 9–14</p></div><button type="button" onClick={onRefresh}>Refresh saved snapshot</button></header>
  <p className="setup-horizons__notice" role="status">{error?'Saved-source refresh failed; any previous snapshot retains its original time. ':''}{catalog?.acquisition_note??(error?'Saved official-source catalog unavailable.':'Loading saved official-source catalog.')}<br/>Snapshot: {time(catalog?.checked_at)} · {catalog?.cache_state??'UNAVAILABLE'}</p>
  <div className="setup-horizons__timeline" role="group" aria-label="Outlook days">{Array.from({length:14},(_,i)=>i+1).map(value=>{const s=catalog?.sources.find(r=>r.day===value);return <button key={value} type="button" aria-pressed={day===value} aria-label={`Day ${value}, ${label(s?.status)}`} onClick={()=>{setDay(value);setSelected(null)}}><strong>D{value}</strong><span>{s?.valid_from?date(s.valid_from):'—'}</span></button>})}</div>
  <div className="setup-horizons__grid" data-expanded={expanded}>
   <section className="setup-horizons__map-panel" aria-label="Outlook map">
    <header><strong>Day {day} · {day<=8?'Official outlook':'Speculative pattern'}</strong><button ref={expandButton} type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Collapse map':'Expand map'}</button></header>
    <label className="setup-horizons__coverage">Map coverage <select value={coverage} onChange={e=>setCoverage(e.target.value)}><option value="conus">Contiguous US</option><option value="alaska">Alaska</option><option value="hawaii">Hawaii</option></select></label>
    <svg viewBox="0 0 1000 600" role="group" aria-label={`${coverage} state boundaries and selected outlook areas`}><g>{shape.selected.map(s=><path key={s.id} d={shape.path(s.polygons)} className="setup-horizons__state"/>)}</g>{coverage==='conus'&&rows.map(r=><path key={r.catalog_id} d={shape.path(r.geometry.type==='Polygon'?[r.geometry.coordinates]:r.geometry.coordinates)} className={r.catalog_id===row?.catalog_id?'setup-horizons__region is-selected':'setup-horizons__region'} fillRule="evenodd" role="button" tabIndex={0} aria-label={`${r.label}, Day ${r.day}`} onClick={()=>setSelected(r.catalog_id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(r.catalog_id)}}}/>)}</svg>
    <p>{coverage!=='conus'?'No supported SPC/model coverage established for this map view.':rows.length?'Area outlines show source geometry; category/severity is given by the source label.':day>=9?'Pattern withheld: no sufficient matching ensemble inputs and verified validity anchor.':source?.status==='no_delineated_area'?'No area delineated in this product; this is not an all-clear.':'Source unavailable or unknown. No replacement forecast is invented.'}</p>
    <small>State boundaries: US Census / us-atlas, ISC license. No map-tile or routing request.</small>
   </section>
   <aside className="setup-horizons__source" aria-label="Selected source details"><h3>{label(source?.status)}</h3><p>{row?.label??(day>=9?'No pattern forecast supplied':'No verified outlook area')}</p>{row&&<p>{row.official_code===2||/thunder/i.test(row.label)?'General thunderstorm guidance; not a severe/tornado or chase-target claim.':row.uncertainty}</p>}<dl><dt>Source</dt><dd>{row?.source??(day<=8?'NOAA Storm Prediction Center':'Ensemble mean/spread inputs required')}</dd><dt>Issued / model run</dt><dd>{time(row?.issued_at??source?.issued_at)}</dd><dt>Valid window</dt><dd>{row?`${time(row.valid_from)} — ${time(row.valid_until)}`:source?.valid_from?`${time(source.valid_from)} — ${time(source.valid_until)}`:'Not established'}</dd><dt>Source checked</dt><dd>{time(source?.checked_at)}</dd><dt>Retained data state</dt><dd>{row?.data_status??'No observed record'}</dd></dl>{source?.reason&&<p>{source.reason}</p>}{href&&<a href={href} target="_blank" rel="noopener noreferrer">Open original source</a>}{rows.length>1&&<div role="group" aria-label="Outlook areas">{rows.map(r=><button key={r.catalog_id} type="button" aria-pressed={r.catalog_id===row?.catalog_id} onClick={()=>setSelected(r.catalog_id)}>{r.label}</button>)}</div>}</aside>
  </div>
  <details className="setup-horizons__preferences"><summary>Planning origins — separate from live positions</summary><label>Nick origin town<input maxLength={80} value={origins.nick} onChange={e=>setOrigins({...origins,nick:e.target.value})}/></label><label>Spencer origin town<input maxLength={80} value={origins.spencer} onChange={e=>setOrigins({...origins,spencer:e.target.value})}/></label><button type="button" onClick={()=>setOrigins({nick:'Topeka, KS',spencer:'Pea Ridge, AR'})}>Reset town defaults</button><p>Nick: {origins.nick||'Choose a town'} · Spencer: {origins.spencer||'Choose a town'}. Session-local only; no location, route or precise coordinates sent. Departure, overnight and meetup remain unplanned.</p></details>
  <details><summary>Evidence history — revision {catalog?.revision??0}</summary>{catalog?.history.slice(-8).map(event=><p key={event.revision}>{time(event.at)} · revision {event.revision}: {event.added.length} added, {event.changed.length} changed, {event.removed.length} removed.</p>)}</details>
 </section>
}
export default function HorizonCatalog(){
 const {config}=useCoreOps(),[catalog,setCatalog]=useState<Catalog|null>(null),[error,setError]=useState<string|null>(null),refresh=useRef<(()=>void)|null>(null)
 useEffect(()=>{const poll=visibleSnapshotPoller({intervalMs:30000,load:(signal:AbortSignal)=>loadHorizonCatalog(config,signal),onData:(value:Catalog)=>{setCatalog(value);setError(null)},onError:()=>setError('UNAVAILABLE')});refresh.current=poll.refresh;return()=>{poll.stop();refresh.current=null}},[config])
 return <HorizonCatalogView catalog={catalog} error={error} onRefresh={()=>refresh.current?.()}/>
}
