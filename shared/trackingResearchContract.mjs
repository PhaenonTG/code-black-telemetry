// Explicit read-only JSON projection shared by private transport and OPS.
// Accepting an installed publisher never grants scientific/operational approval.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID=/^[a-f0-9]{24}$/, HASH=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('TRACKING_INVALID_RESEARCH_CONTRACT')};
const object=x=>{if(!x||typeof x!=='object'||Array.isArray(x))fail();return x};
const finite=(x,min=-Infinity,max=Infinity)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)fail();return x};
const text=(x,pattern)=>{if(typeof x!=='string'||!pattern.test(x))fail();return x};
const time=x=>{if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(x)||!Number.isFinite(Date.parse(x)))fail();return x};
const list=(x,max)=>{if(!Array.isArray(x)||x.length>max)fail();return x};
const codes=x=>list(x,16).map(v=>text(v,/^[A-Z][A-Z0-9_]{0,95}$/));
const position=x=>{object(x);return {lat:finite(x.lat,-90,90),lon:finite(x.lon,-180,180)}};
function domain(x){object(x);if(x.crs!=='EPSG:3857')fail();return {crs:x.crs,x0:finite(x.x0),y0:finite(x.y0),step:finite(x.step,1,100000),width:finite(x.width,1,241),height:finite(x.height,1,241),nominalGroundSpacingMeters:finite(x.nominalGroundSpacingMeters,1,100000),radiusGroundMetersAtSite:finite(x.radiusGroundMetersAtSite,1,120000)}}
function catalogRecord(x){
 object(x);object(x.origin);if(x.site!=='KSRX'||x.origin.id!=='KSRX'||x.product!=='REF'||x.units!=='dBZ'||x.cut!==1||x.ordinal!==1)fail();
 const start=finite(x.start,0),end=finite(x.end,start);
 return {frameId:text(x.frameId,ID),sourceSha256:text(x.sourceSha256,HASH),nativeContentSha256:text(x.nativeContentSha256,HASH),renderContract:text(x.renderContract,/^calibrated-delivery-v7-[a-f0-9]{64}$/),site:'KSRX',origin:{id:'KSRX',...position(x.origin)},product:'REF',units:'dBZ',cut:1,ordinal:1,start,end,meanElevationDegrees:finite(x.meanElevationDegrees,0,90),vcp:x.vcp===null?null:finite(x.vcp,0,999),sourceKind:text(x.sourceKind,/^[A-Z][A-Z0-9_]{0,63}$/),analysisDomain:domain(x.analysisDomain)};
}
function motion(x,history){
 if(x===null)return null;object(x);
 if(x.kind!=='OBSERVED_CENTROID_DISPLACEMENT'||x.directionConvention!=='TOWARD_TRUE_NORTH_CLOCKWISE'||history.length<2)fail();
 const from=history.at(-2),to=history.at(-1),span=finite(x.spanSeconds,30,600);
 if(x.fromFrameId!==from.frameId||x.toFrameId!==to.frameId||Math.abs(span-(Date.parse(to.time)-Date.parse(from.time))/1000)>.001)fail();
 return {kind:x.kind,fromFrameId:from.frameId,toFrameId:to.frameId,spanSeconds:span,speedMetersPerSecond:finite(x.speedMetersPerSecond,0,40),directionToDegrees:x.directionToDegrees===null?null:finite(x.directionToDegrees,0,359.999999999),directionConvention:x.directionConvention,positionErrorFloorMeters:finite(x.positionErrorFloorMeters,0,100000)};
}
export function projectTrackingResearch(value,{mode='LIVE_CLOCK_RESEARCH'}={}){
 const x=object(value);
 if(!['LIVE_CLOCK_RESEARCH','HISTORICAL_REPLAY'].includes(mode)||x.mode!==mode||x.schema!=='codeblack.radar-tracks.v0'||x.bridgeSchema!=='codeblack.native-cache-tracking.v1'||x.publisherVersion!=='native-cache-publisher-v1'||x.productionIntegrated!==true||x.operational!==false||x.scientificallyQualified!==false||x.operationalDecisionsEnabled!==false||x.liveExtrapolationEnabled!==false||list(x.hazards,0).length)fail();
 const base={schema:x.schema,bridgeSchema:x.bridgeSchema,publisherVersion:x.publisherVersion,producerGeneration:text(x.producerGeneration,UUID),mode,productionIntegrated:true,operational:false,scientificallyQualified:false,operationalDecisionsEnabled:false,liveExtrapolationEnabled:false,hazards:[],hazardInference:'NOT_IMPLEMENTED',state:x.state,currentFrameId:x.currentFrameId===null?null:text(x.currentFrameId,ID),suppressionReasons:codes(x.suppressionReasons)};
 if(x.state==='SUPPRESSED'){
  if(x.sourceState!=='UNAVAILABLE'||list(x.tracks,0).length||list(x.inputFrameCatalog,0).length)fail();
  return {...base,sourceState:'UNAVAILABLE',tracks:[],inputFrameCatalog:[]};
 }
 if(!['RESEARCH_OBSERVATIONS_AVAILABLE','STALE_OBSERVATIONS_ONLY'].includes(x.state)||x.algorithm!=='REF_REGION_MUTUAL_UNIQUE_V0'||x.sourceState!=='CACHED_NATIVE_RETAINED')fail();
 const catalog=list(x.inputFrameCatalog,6).map(catalogRecord),byId=new Map(catalog.map(record=>[record.frameId,record]));
 if(!catalog.length||byId.size!==catalog.length||!base.currentFrameId)fail();
 const current=byId.get(base.currentFrameId);if(!current||list(x.frames,1).length!==1)fail();
 const f=object(x.frames[0]);
 if(f.frameId!==current.frameId||f.site!==current.site||f.product!=='REF'||f.cut!==1||f.ordinal!==1||f.sourceSha256!==current.sourceSha256||f.nativeContentSha256!==current.nativeContentSha256||f.renderContract!==current.renderContract||Date.parse(time(f.start))!==current.start||Date.parse(time(f.end))!==current.end)fail();
 const evaluationAt=time(x.evaluationAt),freshness=object(x.freshness),age=finite(freshness.sourceAgeSeconds,0);
 if(Math.abs(age-(Date.parse(evaluationAt)-current.end)/1000)>.001||freshness.targetSeconds!==120||(age>120&&x.state!=='STALE_OBSERVATIONS_ONLY'))fail();
 const tracks=list(x.tracks,64).map(raw=>{
  const t=object(raw);if(t.confidence!=='UNQUALIFIED'||t.extrapolation!==null)fail();
  let previous=-Infinity;
  const history=list(t.history,6).map(rawPoint=>{
   const p=object(rawPoint),record=byId.get(p.frameId),stamp=time(p.time),epoch=Date.parse(stamp);
   if(!record||epoch!==record.end||epoch<=previous||epoch>current.end)fail();previous=epoch;
   return {frameId:record.frameId,time:stamp,position:position(p.position)};
  });
  if(!history.length||history.at(-1).frameId!==current.frameId)fail();
  const observed=motion(t.motion,history),association=text(t.association,/^[A-Z][A-Z0-9_]{0,63}$/);
  if((x.state==='STALE_OBSERVATIONS_ONLY'||age>120)&&observed||observed&&association!=='UNAMBIGUOUS_CONTINUATION')fail();
  return {id:text(t.id,/^KSRX-ref-[a-f0-9]{16}$/),association,confidence:'UNQUALIFIED',position:position(t.position),history,motion:observed,historicalObservedMotion:null,extrapolation:null,suppressionReasons:codes(t.suppressionReasons)};
 });
 if(new Set(tracks.map(t=>t.id)).size!==tracks.length)fail();
 const result={...base,algorithm:x.algorithm,wallClockGeneratedAt:time(x.wallClockGeneratedAt),evaluationAt,freshness:{sourceAgeSeconds:age,wallSourceAgeSeconds:finite(freshness.wallSourceAgeSeconds,0),targetSeconds:120,state:text(freshness.state,/^[A-Z][A-Z0-9_]{0,63}$/)},sourceState:x.sourceState,frames:[{frameId:current.frameId,site:current.site,product:'REF',cut:1,ordinal:1,start:f.start,end:f.end,sourceSha256:current.sourceSha256,nativeContentSha256:current.nativeContentSha256,renderContract:current.renderContract}],inputFrameCatalog:catalog,tracks};
 if(new TextEncoder().encode(JSON.stringify(result)).byteLength>131072)fail();return result;
}
