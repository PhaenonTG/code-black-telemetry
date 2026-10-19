import {useEffect,useRef} from 'react'
import {categoryOf,type CategoryKey} from './outlookCategory'
import type {Region} from './outlookModel'
export function OutlookLegend({rows,day,onHighlight}:{rows:Region[];day:number;onHighlight:(key:CategoryKey|null)=>void}){
 const card=useRef<HTMLDetailsElement>(null)
 useEffect(()=>{
  const element=card.current,parent=element?.parentElement;if(!element||!parent)return
  let compact:boolean|null=null
  const observer=new ResizeObserver(([entry])=>{const next=entry.contentRect.width<420;if(next!==compact){element.open=!next;compact=next}})
  observer.observe(parent);return()=>observer.disconnect()
 },[])
 const cats=[...new Map(rows.map(row=>{const c=categoryOf(row);return[c.key,c] as const})).values()].sort((a,b)=>b.rank-a.rank)
 return <details ref={card} className="outlook-legend" open><summary>Legend <span>· Day {day}</span></summary><strong>{day>=9?'PATTERN SIGNAL':'SPC RISK'}</strong>{cats.length?cats.map(cat=><button type="button" key={cat.key} data-cat={cat.key} onPointerEnter={()=>onHighlight(cat.key)} onPointerLeave={()=>onHighlight(null)} onFocus={()=>onHighlight(cat.key)} onBlur={()=>onHighlight(null)}><i data-pattern={cat.pattern}/><b>{cat.code}{cat.rank>0?' '+cat.rank:''}</b><span>{cat.name}</span></button>):<p>None delineated</p>}</details>
}
