import {formatOpsTime, formatOpsTimestamp, OPS_TIME_ZONE} from '../../core/timeFormat'
import {statusWord, type StatusWord} from '../../core/statusWords'
export type Source={day:number;status:string;reason?:string;source_url?:string;issued_at?:string;valid_from?:string;valid_until?:string;checked_at?:string;last_success_at?:string}
export type Region={catalog_id:string;day:number;kind:string;label:string;official_code?:number;source:string;source_url:string;issued_at:string;valid_from:string;valid_until:string;data_status:string;uncertainty:string;geometry:{type:'Polygon'|'MultiPolygon';coordinates:any[]}}
export type Catalog={schema:string;checked_at:string|null;revision:number;cache_state:string;acquisition_note:string;records:Region[];sources:Source[];history:Array<{at:string;revision:number;added:string[];changed:string[];removed:string[]}>}

export const time=(value?:string|null)=>value&&Number.isFinite(Date.parse(value))?formatOpsTimestamp(value):'—'
export const clock=(value?:string)=>value&&Number.isFinite(Date.parse(value))?formatOpsTime(value):'—'
export const date=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleDateString('en-US',{timeZone:OPS_TIME_ZONE,weekday:'short',month:'short',day:'numeric'}):'Window unknown'
export function dayDate(catalog:Catalog|null,day:number):string|undefined {
 const own=catalog?.sources.find(s=>s.day===day)?.valid_from
 if(own&&Number.isFinite(Date.parse(own)))return own
 const anchor=catalog?.sources.find(s=>s.day===1)?.valid_from??catalog?.checked_at
 if(!anchor||!Number.isFinite(Date.parse(anchor)))return undefined
 return new Date(Date.parse(anchor)+(day-1)*86400000).toISOString()
}
export function contentState(source?:Source,row?:Region,now=Date.now()):StatusWord {
 const end=row?.valid_until??source?.valid_until
 if(end&&Date.parse(end)<=now)return statusWord('Expired')
 if(source?.status==='no_delineated_area')return statusWord('No area')
 if(source?.status==='insufficient_input')return statusWord('Withheld')
 if(source?.status==='available'||row)return statusWord('Available')
 return statusWord(source?.status??'Unavailable')
}
export function snapshotStale(catalog:Catalog|null,now=Date.now()):boolean {
 return !!catalog&&(catalog.cache_state.toLowerCase()==='stale'||!catalog.checked_at||!Number.isFinite(Date.parse(catalog.checked_at))||now-Date.parse(catalog.checked_at)>90*60000)
}
export function sourceStale(source?:Source,now=Date.now()):boolean {
 return source?.status==='stale'||!!source?.checked_at&&now-Date.parse(source.checked_at)>90*60000
}
export const sourceLink=(value?:string)=>{try{const u=new URL(value??'');return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
export const originalSource=(day:number)=>day<=3?`https://www.spc.noaa.gov/products/outlook/day${day}otlk.html`:day<=8?'https://www.spc.noaa.gov/products/exper/day4-8/':null
export function sourceReason(reason:string|undefined,day:number):string|undefined {
 return reason?.replace(/Official Day 8 validity window unavailable/g,`Official Day ${day} validity window unavailable`)
}
