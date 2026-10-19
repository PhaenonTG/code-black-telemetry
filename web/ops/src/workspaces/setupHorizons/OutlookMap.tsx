import {useEffect,useId,useRef,useState,type CSSProperties,type RefObject} from 'react'
import {EmptyState} from '../../components/AsyncViewState'
import {OutlookLegend} from './OutlookLegend'
import {categoryOf,type CategoryKey} from './outlookCategory'
import {clock,date,type Source} from './outlookModel'
import type {mapShape,ProjectedRegion} from './outlookGeometry'
type Shape=ReturnType<typeof mapShape>
function OutlookLabels({regions}:{regions:ProjectedRegion[]}){
 const layer=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:1000,height:600})
 useEffect(()=>{const element=layer.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(element);return()=>observer.disconnect()},[])
 const scale=Math.min(size.width/1000,size.height/600),placed:Array<{x:number;y:number}>=[]
 return <div ref={layer} className="outlook-map-labels" aria-hidden="true">{regions.toReversed().map(({row,points})=>{
  const cat=categoryOf(row),xs=points.map(p=>p[0]),ys=points.map(p=>p[1])
  const center=cat.key==='high'||cat.key==='spec',px=center?(Math.min(...xs)+Math.max(...xs))/2:Math.max(...xs),py=center?(Math.min(...ys)+Math.max(...ys))/2:Math.min(...ys)
  const x=Math.max(66,Math.min(size.width-66,(size.width-1000*scale)/2+px*scale)),y=Math.max(110,Math.min(size.height-24,(size.height-600*scale)/2+py*scale))
  if(placed.some(p=>Math.abs(p.x-x)<132&&Math.abs(p.y-y)<34))return null
  placed.push({x,y})
  return <div key={row.catalog_id} data-cat={cat.key} className="outlook-area-label" style={{left:x,top:y}}>{cat.code}{cat.rank>0?' '+cat.rank:''}</div>
 })}</div>
}
export function OutlookMap({day,valid,source,regions,shape,coverage,onCoverage,expanded,onExpand,expandButton,selected,onSelect}:{day:number;valid?:string;source?:Source;regions:ProjectedRegion[];shape:Shape;coverage:string;onCoverage:(v:string)=>void;expanded:boolean;onExpand:()=>void;expandButton:RefObject<HTMLButtonElement|null>;selected?:string;onSelect:(id:string)=>void}){
 const id=useId().replace(/:/g,''),[highlight,setHighlight]=useState<CategoryKey|null>(null)
 const [transition,setTransition]=useState({day,regions,previous:[] as ProjectedRegion[]})
 if(transition.day!==day||transition.regions!==regions)setTransition({day,regions,previous:transition.day!==day?transition.regions:transition.previous})
 useEffect(()=>{const timer=setTimeout(()=>setTransition(v=>({...v,previous:[]})),220);return()=>clearTimeout(timer)},[day])
 const highest=Math.max(...regions.map(r=>categoryOf(r.row).rank))
 return <section className="setup-horizons__map-panel" aria-label="Outlook map"><header><strong>Day {day} · {day<=8?'Official outlook':'Speculative pattern'}</strong><button ref={expandButton} type="button" aria-expanded={expanded} onClick={onExpand}>{expanded?'Collapse map':'Expand map'}</button></header>
 <label className="setup-horizons__coverage">Map coverage <select value={coverage} onChange={e=>onCoverage(e.target.value)}><option value="conus">Contiguous US</option><option value="alaska">Alaska</option><option value="hawaii">Hawaii</option></select></label>
 <div className="outlook-map-art"><div className="outlook-map-title"><strong>DAY {day} · {date(valid)}</strong><span>{day<=8?`SPC Day ${day} Convective Outlook`:'Speculative · low confidence · not SPC'} · {clock(source?.valid_from)} · {clock(source?.valid_until)}</span></div>
 <svg viewBox="0 0 1000 600" role="group" aria-label={`${coverage} state boundaries and selected outlook areas`}><defs><linearGradient id={`${id}-land`} x2="0" y2="1"><stop stopColor="var(--cb-outlook-land)"/><stop offset="1" stopColor="var(--cb-outlook-land-bottom)"/></linearGradient>{['enh','mdt','high','spec'].map(cat=><pattern key={cat} id={`${id}-${cat}`} width={cat==='high'?7:12} height={cat==='high'?7:12} patternUnits="userSpaceOnUse" patternTransform={`rotate(${cat==='spec'?-45:45})`}><path d={cat==='mdt'||cat==='high'?'M0 0V12M0 0H12':'M0 0V12'} fill="none" stroke={`var(--cb-outlook-${cat})`} strokeWidth="2" opacity=".6"/></pattern>)}</defs>
 <g>{shape.selected.map(s=><path key={s.id} d={s.d} className="setup-horizons__state" style={{fill:`url(#${id}-land)`}} vectorEffect="non-scaling-stroke"/>)}</g>
 {coverage==='conus'&&<g className="outlook-regions-old" aria-hidden="true">{transition.previous.map(({row,d})=>{const cat=categoryOf(row);return <path key={row.catalog_id} d={d} fill={`var(--cb-outlook-${cat.key})`} fillOpacity={cat.opacity} stroke={`var(--cb-outlook-${cat.key})`} strokeWidth={cat.width} vectorEffect="non-scaling-stroke"/>})}</g>}
 <g key={day} className="outlook-regions">{coverage==='conus'&&regions.map(({row,d})=>{
 const cat=categoryOf(row),active=row.catalog_id===selected,w=cat.width+(expanded?.5:0)+(active?1.5:0)+(highlight===cat.key?1:0)
 const style={'--cat':`var(--cb-outlook-${cat.key})`,'--weight':`${w}px`} as CSSProperties
 return <g key={row.catalog_id} data-cat={cat.key} style={style} className="outlook-area"><path d={d} fill="var(--cat)" fillOpacity={cat.opacity} fillRule="evenodd"/><path d={d} fill={cat.pattern==='none'?'none':`url(#${id}-${cat.key})`} fillRule="evenodd"/>
 <path d={d} className={cat.rank===highest&&highest>=3?'outlook-glow is-top':'outlook-glow'} vectorEffect="non-scaling-stroke"/>
 {active&&<path d={d} fill="none" stroke="white" strokeOpacity=".6" strokeWidth={w+4} vectorEffect="non-scaling-stroke"/>}
 <path d={d} fill="none" stroke="rgba(0,0,0,.7)" strokeWidth={w+2} vectorEffect="non-scaling-stroke"/>
 <path d={d} className="setup-horizons__region" fillRule="evenodd" role="button" tabIndex={0} aria-label={`${cat.name}, ${row.label}, Day ${day}${active?', selected':''}`} aria-pressed={active} vectorEffect="non-scaling-stroke" onClick={()=>onSelect(row.catalog_id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(row.catalog_id)}}}><title>{`${row.label} · ${cat.name}`}</title></path>
 </g>
 })}</g>{day>=9&&<g aria-hidden="true"><foreignObject x="180" y="240" width="640" height="120"><div className="outlook-watermark">SPECULATIVE</div></foreignObject></g>}</svg>
 {coverage==='conus'?<><OutlookLabels regions={regions}/><OutlookLegend key={day} rows={regions.map(r=>r.row)} day={day} onHighlight={setHighlight}/></>:<div className="outlook-coverage-empty"><EmptyState title="No outlook areas here" message="SPC covers the contiguous US only." onRetry={()=>onCoverage('conus')} retryLabel="Switch to Contiguous US"/></div>}
 </div><p>{coverage!=='conus'?'No supported SPC/model coverage established for this map view.':regions.length?'Area outlines show source geometry; category/severity is given by the source label.':day>=9?'Pattern withheld: no sufficient matching ensemble inputs and verified validity anchor.':source?.status==='no_delineated_area'?'No area delineated in this product; this is not an all-clear.':'Source unavailable or unknown. No replacement forecast is invented.'}</p>
 {coverage==='conus'&&!regions.length&&<EmptyState compact title={day>=9?'Pattern withheld':source?.status==='no_delineated_area'?'No area delineated':'Outlook unavailable'} message={day>=9?'No sufficient matching ensemble inputs and verified validity anchor.':source?.status==='no_delineated_area'?'This is not an all-clear.':'No replacement forecast is invented.'}/>}
 <small>Boundaries: US Census / us-atlas (ISC) · Source: {day<=8?'NOAA SPC':'Code Black WX analysis · not SPC'} · No map-tile or routing request.</small></section>
}
