import {mkdir,readFile,rename,writeFile} from 'node:fs/promises'
import path from 'node:path'

const BASE='https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer'
const PRODUCTS=[
 {day:1,product:'categorical',layer:1},{day:1,product:'tornado',layer:3,significantLayer:2},{day:1,product:'hail',layer:5,significantLayer:4},{day:1,product:'wind',layer:7,significantLayer:6},
 {day:2,product:'categorical',layer:9},{day:2,product:'tornado',layer:11,significantLayer:10},{day:2,product:'hail',layer:13,significantLayer:12},{day:2,product:'wind',layer:15,significantLayer:14},
 {day:3,product:'categorical',layer:17},{day:3,product:'severe',layer:19,significantLayer:18},
 {day:4,product:'severe',layer:21},{day:5,product:'severe',layer:22},{day:6,product:'severe',layer:23},{day:7,product:'severe',layer:24},{day:8,product:'severe',layer:25},
]
const MAX_FEATURES=500,REQUEST_TIMEOUT_MS=20_000
const argument=name=>{const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined}
const output=path.resolve(process.cwd(),argument('--output')??'public/dev-data/current-spc-graphics.json')
const healthOutput=path.resolve(process.cwd(),argument('--health-output')??`${output}.health.json`)
const analysisPath=argument('--analysis')?path.resolve(process.cwd(),argument('--analysis')):undefined

function iso(value){if(typeof value==='number'&&value>1_000_000_000_000)return new Date(value).toISOString();if(!/^\d{12}$/.test(String(value??'')))return undefined;const text=String(value);return new Date(`${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}T${text.slice(8,10)}:${text.slice(10,12)}:00Z`).toISOString()}
function geometry(value){if(!value||!['Polygon','MultiPolygon'].includes(value.type)||!Array.isArray(value.coordinates))throw Error('INVALID_OFFICIAL_GEOMETRY');return value}
async function fetchJson(url){let finalError;for(let attempt=1;attempt<=2;attempt++){try{const response=await fetch(url,{headers:{'user-agent':'CodeBlack-GraphicsCollector/2.0'},signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});if(!response.ok)throw Error(`HTTP_${response.status}`);return await response.json()}catch(error){finalError=error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500))}}throw finalError}
async function readLayer(layer){
 const query=new URLSearchParams({where:'1=1',outFields:'*',returnGeometry:'true',outSR:'4326',f:'geojson'})
 const payload=await fetchJson(`${BASE}/${layer}/query?${query}`)
 if(payload?.type!=='FeatureCollection'||!Array.isArray(payload.features)||payload.features.length>MAX_FEATURES)throw Error(`SPC_LAYER_${layer}_INVALID`)
 return payload.features
}
async function optionalAnalysis(){
 if(!analysisPath)return[]
 const payload=JSON.parse(await readFile(analysisPath,'utf8'))
 if(!Array.isArray(payload)||payload.some(item=>item?.status!=='reviewed'||!Number.isInteger(item.day)||item.day<1||item.day>8||!item.reviewed_at||!item.reviewer||!item.source_note||!item.summary||!Array.isArray(item.key_messages)||item.key_messages.length>5))throw Error('INVALID_REVIEWED_ANALYSIS')
 return payload
}
async function atomicJson(target,value){await mkdir(path.dirname(target),{recursive:true});const temporary=`${target}.${process.pid}.tmp`;await writeFile(temporary,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temporary,target)}
async function previousSuccess(){try{const previous=JSON.parse(await readFile(output,'utf8'));return previous.checked_at}catch{return null}}

const checkedAt=new Date().toISOString(),startedAt=Date.now()
try{
 const layerIds=[...new Set(PRODUCTS.flatMap(item=>[item.layer,item.significantLayer]).filter(Number.isInteger))]
 const layerEntries=await Promise.all(layerIds.map(async layer=>[layer,await readLayer(layer)])),layers=new Map(layerEntries)
 const dayAnchors=new Map()
 for(const item of PRODUCTS.filter(item=>item.product==='categorical')){const anchor=(layers.get(item.layer)??[]).map(feature=>feature.properties??{}).find(props=>iso(props.valid)&&iso(props.expire));if(anchor)dayAnchors.set(item.day,anchor)}
 const dataset={schema:'codeblack.spc.graphics.v2',checked_at:checkedAt,regions:[],sources:[],analysis:await optionalAnalysis()}
 for(const item of PRODUCTS){
  const allFeatures=layers.get(item.layer)??[],allSignificant=item.significantLayer?layers.get(item.significantLayer)??[]:[],features=allFeatures.filter(feature=>Number(feature.properties?.dn)>0),significant=allSignificant.filter(feature=>Number(feature.properties?.dn)>0),own=features.map(feature=>feature.properties??{}).find(props=>iso(props.valid)&&iso(props.expire))??dayAnchors.get(item.day)??allFeatures[0]?.properties,validUntil=iso(own?.expire)
  const status=validUntil&&Date.parse(validUntil)<=Date.parse(checkedAt)?'stale':features.length?'available':'no_delineated_area'
  dataset.sources.push({product:item.product,day:item.day,status,source_url:`${BASE}/${item.layer}`,...(item.significantLayer?{significant_source_url:`${BASE}/${item.significantLayer}`}:{ }),issued_at:iso(own?.issue)??iso(own?.idp_filedate),valid_from:iso(own?.valid),valid_until:validUntil,checked_at:checkedAt})
  const append=(feature,index,overlay=false)=>{const props=feature.properties??{},dn=Number(props.dn);if(!Number.isInteger(dn)||dn<=0)throw Error(`SPC_LAYER_${overlay?item.significantLayer:item.layer}_INVALID_DN`);dataset.regions.push({catalog_id:`spc-day${item.day}-${item.product}-${overlay?'significant':dn}-${index}`,day:item.day,kind:'official_spc_outlook',hazard:item.product,label:String(props.label2??props.label??(overlay?'Significant severe area':`${dn}%`)),official_code:dn,...(item.product==='categorical'||overlay?{}:{probability_percent:dn}),significant:overlay,overlay_only:overlay,source:'NOAA Storm Prediction Center',source_url:`${BASE}/${overlay?item.significantLayer:item.layer}`,issued_at:iso(props.issue)??iso(own?.issue),valid_from:iso(props.valid)??iso(own?.valid),valid_until:iso(props.expire)??validUntil,data_status:status==='stale'?'stale':'current',uncertainty:overlay?'Official SPC conditional-intensity delineation; shown as a significant-area overlay, not a separate probability.':'Official SPC outlook polygon; not an observed storm or proprietary Code Black rating.',geometry:geometry(feature.geometry)})}
  features.forEach((feature,index)=>append(feature,index));significant.forEach((feature,index)=>append(feature,index,true))
 }
 await atomicJson(output,dataset)
 await atomicJson(healthOutput,{schema:'codeblack.spc.graphics-health.v1',status:'HEALTHY',checked_at:checkedAt,last_success_at:checkedAt,duration_ms:Date.now()-startedAt,source:BASE,products:dataset.sources.length,regions:dataset.regions.length})
 console.log(JSON.stringify({status:'PASS',output,health_output:healthOutput,checked_at:checkedAt,products:dataset.sources.length,regions:dataset.regions.length,analysis:dataset.analysis.length}))
}catch(error){
 const message=error instanceof Error?error.message:String(error),lastSuccessAt=await previousSuccess();await atomicJson(healthOutput,{schema:'codeblack.spc.graphics-health.v1',status:'DEGRADED',checked_at:checkedAt,last_success_at:lastSuccessAt,duration_ms:Date.now()-startedAt,source:BASE,error:message,retained_last_good:!!lastSuccessAt});console.error(JSON.stringify({status:'FAIL',error:message,retained_last_good:!!lastSuccessAt,health_output:healthOutput}));process.exitCode=1
}
