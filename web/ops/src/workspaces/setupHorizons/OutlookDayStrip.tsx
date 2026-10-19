import {categoryOf} from './outlookCategory'
import {contentState,date,dayDate,clock,type Catalog} from './outlookModel'
export function OutlookDayStrip({catalog,day,onDay,now}:{catalog:Catalog|null;day:number;onDay:(day:number)=>void;now:number}){
 return <div className="setup-horizons__timeline" role="group" aria-label="Outlook days">{[ [1,8],[9,14] ].map(([start,end])=><div key={start} className="outlook-day-group" data-spec={start===9}>
  <p>{start===1?'OFFICIAL · NOAA SPC · DAYS 1–8':'SPECULATIVE · PATTERN · DAYS 9–14'}</p><div>{Array.from({length:end-start+1},(_,i)=>i+start).map(value=>{
   const source=catalog?.sources.find(s=>s.day===value),rows=catalog?.records.filter(r=>r.day===value)??[],top=rows.toSorted((a,b)=>categoryOf(b).rank-categoryOf(a).rank)[0],cat=top?categoryOf(top):null,state=contentState(source,top,now)
   const valid=dayDate(catalog,value),description=`Day ${value}, ${state}, ${date(valid)}. Valid ${clock(source?.valid_from)} – ${clock(source?.valid_until)}`
   return <button key={value} type="button" data-cat={cat?.key} data-empty={!rows.length} data-expired={state==='Expired'} aria-pressed={day===value} aria-label={description} title={description} onClick={()=>onDay(value)}><strong>D{value}</strong><span>{date(valid).replace(/,? [A-Z][a-z]{2} /,' ')}</span><span className={!top&&state==='Unavailable'?'outlook-day-unavailable':undefined}>{top?`${cat?.code}${cat&&cat.rank>0?' '+cat.rank:''}`:state==='Unavailable'?<><span className="outlook-day-full">{state}</span><span className="outlook-day-dash" aria-hidden="true">{String.fromCharCode(8212)}</span></>:state}</span>{state==='Expired'&&top&&<span>Expired</span>}</button>
  })}</div></div>)}</div>
}
