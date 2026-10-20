import type {Catalog} from '../HorizonCatalog'
import type {ForecastGraphicPreset} from './forecastGraphicPresets'

export type CategoryKey='tstm'|'mrgl'|'slgt'|'enh'|'mdt'|'high'|'unknown'
export type GraphicProduct='categorical'|'tornado'|'wind'|'hail'|'severe'|'key-messages'
export type GraphicCoverage='national'|'southern-plains'
export type GraphicSource={
 product:GraphicProduct
 day:number
 status:'available'|'no_delineated_area'|'unavailable'|'stale'
 source_url:string
 significant_source_url?:string
 issued_at?:string
 valid_from?:string
 valid_until?:string
 checked_at?:string
}
export type GraphicRegion={
 catalog_id:string
 day:number
 kind:string
 hazard:Exclude<GraphicProduct,'key-messages'>
 label:string
 official_code?:number
 probability_percent?:number
 significant?:boolean
 overlay_only?:boolean
 source:string
 source_url:string
 issued_at?:string
 valid_from?:string
 valid_until?:string
 data_status:string
 uncertainty:string
 geometry:{type:'Polygon'|'MultiPolygon';coordinates:any[]}
}
export type ReviewedAnalysis={
 status:'reviewed'
 day:number
 reviewed_at:string
 reviewer:string
 source_note:string
 summary:string
 key_messages:string[]
 hazard_ratings?:Partial<Record<'tornado'|'wind'|'hail',string>>
}
export type GraphicDataset={schema:'codeblack.spc.graphics.v2';checked_at:string|null;regions:GraphicRegion[];sources:GraphicSource[];analysis?:ReviewedAnalysis[]}
export type GraphicRequest={dataset:GraphicDataset;product:GraphicProduct;day:number;coverage:GraphicCoverage;preset:ForecastGraphicPreset;now?:number}

export const COVERAGE_BOUNDS:Record<GraphicCoverage,[[number,number],[number,number]]>={
 national:[[-126.5,23],[-66,50.5]],
 'southern-plains':[[-106.8,29],[-92.2,39.3]],
}

export const CATEGORY_COLORS:Record<CategoryKey,string>={
 tstm:'#66B96A',mrgl:'#3DDC84',slgt:'#FFE24A',enh:'#FF8A25',mdt:'#EF3F54',high:'#E83DEB',unknown:'#8D949B',
}
export const PROBABILITY_COLORS:Record<'tornado'|'wind'|'hail'|'severe',Record<number,string>>={
 tornado:{2:'#79BA7A',5:'#BD998A',10:'#FFE481',15:'#FF8080',30:'#FF80FF',45:'#C896F7',60:'#104E8B'},
 wind:{5:'#C5A392',15:'#FFEB7F',30:'#FF7F7F',45:'#FF7FFF',60:'#C895F6',75:'#5C85D6',90:'#1AFFFF'},
 hail:{5:'#C5A392',15:'#FFEB7F',30:'#FF7F7F',45:'#FF7FFF',60:'#C895F6',75:'#5C85D6',90:'#1AFFFF'},
 severe:{5:'#C5A392',15:'#FFEB7F',30:'#FF7F7F',45:'#FF7FFF',60:'#C895F6',75:'#5C85D6'},
}

export const PRODUCT_META:Record<GraphicProduct,{title:string;short:string}>={
 categorical:{title:'CATEGORICAL OUTLOOK',short:'Categorical'},
 tornado:{title:'TORNADO PROBABILITY OUTLOOK',short:'Tornado'},
 hail:{title:'LARGE HAIL PROBABILITY OUTLOOK',short:'Hail'},
 wind:{title:'DAMAGING WIND PROBABILITY OUTLOOK',short:'Wind'},
 severe:{title:'SEVERE PROBABILITY OUTLOOK',short:'Severe'},
 'key-messages':{title:'KEY MESSAGES',short:'Key messages'},
}

const CATEGORY_BY_CODE:Record<number,{key:CategoryKey;name:string;rank:number}>={
 2:{key:'tstm',name:'General thunderstorms',rank:0},
 3:{key:'mrgl',name:'Marginal Risk (1 of 5)',rank:1},
 4:{key:'slgt',name:'Slight Risk (2 of 5)',rank:2},
 5:{key:'enh',name:'Enhanced Risk (3 of 5)',rank:3},
 6:{key:'mdt',name:'Moderate Risk (4 of 5)',rank:4},
 8:{key:'high',name:'High Risk (5 of 5)',rank:5},
}

function categoryOf(row:Pick<GraphicRegion,'official_code'|'label'>){
 const coded=row.official_code===undefined?undefined:CATEGORY_BY_CODE[row.official_code]
 if(coded)return coded
 const text=row.label.toLowerCase()
 if(/high/.test(text))return CATEGORY_BY_CODE[8]
 if(/moderate|\bmdt\b/.test(text))return CATEGORY_BY_CODE[6]
 if(/enhanced|\benh\b/.test(text))return CATEGORY_BY_CODE[5]
 if(/slight|\bslgt\b/.test(text))return CATEGORY_BY_CODE[4]
 if(/marginal|\bmrgl\b/.test(text))return CATEGORY_BY_CODE[3]
 if(/thunder|\btstm\b/.test(text))return CATEGORY_BY_CODE[2]
 return{key:'unknown' as const,name:row.label||'Unknown category',rank:-1}
}

export function availableProducts(day:number):GraphicProduct[]{
 if(day<=2)return['categorical','tornado','wind','hail','key-messages']
 if(day===3)return['categorical','severe','key-messages']
 if(day<=8)return['severe','key-messages']
 return[]
}

export function officialProductUrl(day:number){return day<=3?`https://www.spc.noaa.gov/products/outlook/day${day}otlk.html`:'https://www.spc.noaa.gov/products/exper/day4-8/'}
export function datasetFromCatalog(catalog:Catalog):GraphicDataset{
 const sources:GraphicSource[]=catalog.sources.filter(source=>source.day<=8).map(source=>({
  product:source.day<=3?'categorical':'severe',day:source.day,status:source.status as GraphicSource['status'],
  source_url:source.source_url??officialProductUrl(source.day),issued_at:source.issued_at,valid_from:source.valid_from,
  valid_until:source.valid_until,checked_at:source.checked_at,
 }))
 return{
  schema:'codeblack.spc.graphics.v2',checked_at:catalog.checked_at,
  regions:catalog.records.filter(row=>row.day<=8).map(row=>({...row,hazard:(row.day<=3?'categorical':'severe') as GraphicRegion['hazard']})),
  sources,
 }
}

export function sourceFor(request:Pick<GraphicRequest,'dataset'|'product'|'day'>):GraphicSource|undefined{return request.dataset.sources.find(source=>source.day===request.day&&source.product===request.product)}
export function regionsFor(request:Pick<GraphicRequest,'dataset'|'product'|'day'>):GraphicRegion[]{return request.dataset.regions.filter(row=>row.day===request.day&&row.hazard===request.product)}
export function reviewedAnalysisFor(request:Pick<GraphicRequest,'dataset'|'day'>){return request.dataset.analysis?.find(item=>item.day===request.day&&item.status==='reviewed')}
export function regionColor(row:GraphicRegion):string{
 if(row.overlay_only)return'#F4F6FA'
 if(row.hazard==='categorical')return CATEGORY_COLORS[categoryOf(row).key]
 return PROBABILITY_COLORS[row.hazard]?.[row.probability_percent??row.official_code??-1]??'#8D949B'
}
export function regionRank(row:GraphicRegion):number{return row.overlay_only?999:row.hazard==='categorical'?categoryOf(row).rank:row.probability_percent??row.official_code??-1}
export function productLegend(request:Pick<GraphicRequest,'dataset'|'product'|'day'>){
 const rows=regionsFor(request).filter(row=>!row.overlay_only).toSorted((a,b)=>regionRank(b)-regionRank(a))
 if(request.product==='categorical'){
  const seen=new Set<string>()
  return rows.flatMap(row=>{const category=categoryOf(row);if(seen.has(category.key))return[];seen.add(category.key);return[{label:category.name,color:CATEGORY_COLORS[category.key]}]})
 }
 if(request.product==='key-messages')return[]
 const values=[...new Set(rows.map(row=>row.probability_percent??row.official_code).filter((value):value is number=>typeof value==='number'))].sort((a,b)=>b-a)
 const probabilityProduct=request.product as 'tornado'|'wind'|'hail'|'severe'
 return values.map(value=>({label:`${value}%`,color:PROBABILITY_COLORS[probabilityProduct][value]??'#8D949B'}))
}
export function highestLabel(request:Pick<GraphicRequest,'dataset'|'product'|'day'>):string{
 if(request.product==='key-messages')return reviewedAnalysisFor(request)?.summary??'REVIEWED ANALYSIS UNAVAILABLE'
 const row=regionsFor(request).filter(item=>!item.overlay_only).toSorted((a,b)=>regionRank(b)-regionRank(a))[0]
 if(!row)return sourceFor(request)?.status==='no_delineated_area'?'NO AREA DELINEATED':'SOURCE UNAVAILABLE'
 if(request.product==='categorical')return categoryOf(row).name.toUpperCase()
 return `${row.probability_percent??row.official_code}%${regionsFor(request).some(item=>item.overlay_only||item.significant)?' · SIGNIFICANT AREA':''}`
}
export function graphicTitle(request:Pick<GraphicRequest,'product'|'day'>){return `DAY ${request.day} ${PRODUCT_META[request.product].title}`}
export function graphicFilename(request:GraphicRequest){
 const source=sourceFor(request),stamp=source?.valid_from&&Number.isFinite(Date.parse(source.valid_from))?source.valid_from.slice(0,10):request.dataset.checked_at?.slice(0,10)??'undated'
 return `codeblackwx-day${request.day}-${request.product}-${request.coverage}-${stamp}-${request.preset.width}x${request.preset.height}.png`
}
