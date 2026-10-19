import {radarSitePattern} from '../../../../shared/radarSitePolicy.mjs';
const PREFIX='/api/ops-radar/v1/';
export function radarOrigin(value=globalThis.location?.origin){
 const origin=value&&value!=='null'?value:'https://ops.codeblackwx.com';
 const url=new URL(origin);
 if(url.origin!==origin||url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw Error('Exact secure radar origin required');
 return origin;
}
const idPattern=/^[a-f0-9]{16,64}$/;
export function pilotSelection(product='REF',site='KSRX'){
 if(!['REF','VEL','CC'].includes(product))throw Error('Unsupported pilot product');
 if(!radarSitePattern.test(site))throw Error('Explicit radar site required');
 return {site,product,cut:product==='VEL'?2:1};
}
function sessionToken(getSession,now){
 const session=getSession();return session&&typeof session.accessToken==='string'&&session.accessToken.length>0&&session.expiresAtMs>now()?session.accessToken:null;
}
function route(url,kind,origin){
 const parsed=new URL(url,origin);
 if(parsed.origin!==origin||parsed.username||parsed.password||parsed.hash)return null;
 if(kind==='tile')return !parsed.search&&/^\/api\/ops-radar\/v1\/tiles\/[a-f0-9]{16,64}\/\d{1,2}\/\d{1,7}\/\d{1,7}\.png$/.test(parsed.pathname)?parsed:null;
 if(parsed.pathname===PREFIX+'tracks'){
  const keys=[...parsed.searchParams.keys()];
  return keys.length===3&&new Set(keys).size===3&&keys.every(key=>['site','product','tilt'].includes(key))&&parsed.searchParams.get('site')==='KSRX'&&parsed.searchParams.get('product')==='REF'&&parsed.searchParams.get('tilt')==='1'?parsed:null;
 }
 if(parsed.pathname===PREFIX+'frames'){
  const product=parsed.searchParams.get('product');if(!['REF','VEL','CC'].includes(product))return null;const site=parsed.searchParams.get('site');if(!radarSitePattern.test(site??''))return null;const selection=pilotSelection(product,site);
  if([...parsed.searchParams.keys()].length!==4||parsed.searchParams.get('site')!==selection.site||parsed.searchParams.get('tilt')!==String(selection.cut)||parsed.searchParams.get('limit')!=='1')return null;
  return parsed;
 }
 return !parsed.search&&/^\/api\/ops-radar\/v1\/frame\/[a-f0-9]{16,64}\/metadata$/.test(parsed.pathname)?parsed:null;
}
/** Host supplies current session state in memory, including expiry; no persistence or auth config. */
export function createPrivateRadarClient({getSession,fetchImpl=fetch,now=Date.now,origin=radarOrigin()}={}){
 origin=radarOrigin(origin);
 if(typeof getSession!=='function')throw Error('Current session getter required');
 return {
  // Return null for every non-radar resource so the host retains its existing transform.
  // Missing/expired session fails closed for this private tile prefix; no anonymous retry.
  transformTileRequest(url){
   const target=route(url,'tile',origin);if(!target)return null;
   const token=sessionToken(getSession,now);if(!token)throw Error('Radar session required');
   return {url:target.href,headers:{Authorization:'Bearer '+token}};
  },
  async read(path,{signal}={}){
   const target=route(path,'json',origin);if(!target)throw Error('Private radar route required');
   const token=sessionToken(getSession,now);if(!token)return {state:'AUTH_REQUIRED'};
   const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,10000);
   let reader,response;
   const cancelled=new Promise((_,reject)=>{if(controller.signal.aborted)reject(Error('aborted'));else controller.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
   try{
    response=await Promise.race([fetchImpl(target.href,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal}),cancelled]);
    if(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return {state:'INVALID_RESPONSE'};
    reader=response.body?.getReader();let size=0;const chunks=[];
    if(reader)while(true){const item=await Promise.race([reader.read(),cancelled]);if(item.done)break;size+=item.value.length;if(size>131072)return {state:'INVALID_RESPONSE'};chunks.push(item.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const data=JSON.parse(new TextDecoder().decode(bytes));
    if(response.status===401||response.status===403)return {state:'AUTH_REQUIRED'};
    if(response.status===503&&data?.reason==='FRAME_PENDING')return {state:'PENDING',reason:'FRAME_PENDING'};
    if(!response.ok)return {state:'UNAVAILABLE',reason:typeof data?.reason==='string'?data.reason:null};
    return {state:'RECEIVED',data};
   }catch{return {state:controller.signal.aborted?'CANCELLED':'UNAVAILABLE'};}
   finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();try{const cleanup=reader?reader.cancel():response?.body?.cancel();void cleanup?.catch(()=>{});}catch{}}
  }
 };
}

export function acceptedFrameView(frame,selection,sourceLoadedFrameId,origin=radarOrigin()){
 if(!frame||!idPattern.test(frame.frameId??'')||frame.site?.id!==selection.site||frame.product!==selection.product||frame.tilt!==selection.cut||!Number.isFinite(Date.parse(frame.time))||!Number.isFinite(frame.ageSeconds)||frame.ageSeconds<0||!['LIVE','DELAYED','STALE','CACHED','INCOMPLETE'].includes(frame.freshness))return {state:'UNAVAILABLE',frame:null};
 if(sourceLoadedFrameId!==frame.frameId)return {state:'PENDING',frame:null};
 return {state:frame.freshness,frame:{...frame,tileTemplate:`${radarOrigin(origin)}${PREFIX}tiles/${frame.frameId}/{z}/{x}/{y}.png`}};
}

export function metadataLegend(frame,product){
 const legend=frame?.legend,units={REF:'dBZ',VEL:'kt',CC:'rho-hv'}[product];
 if(frame?.product!==product||!units||legend?.kind!=='linear'||legend.units!==units||!Array.isArray(legend.colorStops))return null;
 const stops=legend.colorStops;
 if(stops.length<2||stops.length>64||!stops.every((s,i)=>Array.isArray(s)&&s.length===2&&Number.isFinite(s[0])&&(i===0||s[0]>stops[i-1][0])&&Array.isArray(s[1])&&s[1].length===3&&s[1].every(c=>Number.isInteger(c)&&c>=0&&c<=255)))return null;
 const min=stops[0][0],max=stops.at(-1)[0];return {units,min,max,gradient:`linear-gradient(90deg, ${stops.map(([value,rgb])=>`rgb(${rgb.join(',')}) ${100*(value-min)/(max-min)}%`).join(', ')})`};
}
