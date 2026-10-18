import {TrackingPanel} from '../radarTracking/TrackingPanel';
import {loadTrackingSnapshot} from '../radarTracking/loadTrackingSnapshot.mjs';
import {useEffect,useMemo,useRef,useState} from 'react';
import mapboxgl, {type Map as MapboxMap} from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './PrivateRadarPilot.css';
import {atlasStyleUri,hasMapboxToken,mapboxAccessToken} from '../../../../src/services/mapTiles';
import type {RadarFrame} from '../../../../src/services/radar';
import {createPrivateRadarClient,pilotSelection,metadataLegend} from './privateRadarClient.mjs';
import {loadPilotFrame,createPilotFrameUpdates} from './privateRadarPilot.mjs';
import {startVisibleRadarRefresh,currentRadarAge} from './visibleRadarRefresh.mjs';

type Session={userId:string;accessToken:string;expiresAtMs:number}|null;
export function PrivateRadarPilot({active,session,onFrame,site='KSRX'}:{active:boolean;session:Session;site?:string;onFrame:(frame:RadarFrame|null)=>void}){
 const container=useRef<HTMLDivElement>(null),map=useRef<MapboxMap|null>(null),currentSession=useRef(session),notify=useRef(onFrame),removeFrame=useRef<(()=>void)|null>(null);
 currentSession.current=session;notify.current=onFrame;
 const [expired,setExpired]=useState(false),[ready,setReady]=useState(false),[product,setProduct]=useState('REF'),[phase,setPhase]=useState('PENDING'),[frame,setFrame]=useState<RadarFrame|null>(null),[clock,setClock]=useState(Date.now());
 const refreshCurrent=useRef<(()=>void)|null>(null),receivedAt=useRef(0);
 const [tracking,setTracking]=useState<any>(null),trackingReceivedAt=useRef(0);
 const client=useMemo(()=>createPrivateRadarClient({getSession:()=>currentSession.current}),[]);
 useEffect(()=>{
  setExpired(false);if(!session)return;
  const duration=session.expiresAtMs-Date.now();if(duration<=0){currentSession.current=null;setExpired(true);return;}
  const timer=window.setTimeout(()=>{currentSession.current=null;setExpired(true);},Math.min(duration,2147483647));return ()=>window.clearTimeout(timer);
 },[session?.accessToken,session?.expiresAtMs]);
 useEffect(()=>{
  setReady(false);setFrame(null);notify.current(null);
  if(!active||!session||expired)return;
  let disposed=false,instance:MapboxMap|null=null;
  const previousImageLimit=mapboxgl.maxParallelImageRequests;
  // Both private read hops admit eight requests. Leave headroom for metadata
  // and other authorized reads rather than flooding them with a full viewport.
  mapboxgl.maxParallelImageRequests=Math.min(previousImageLimit,4);
  void Promise.resolve(hasMapboxToken()).then(available=>{
   if(disposed)return;if(!available||!container.current){setPhase('MAP_UNAVAILABLE');return;}
   mapboxgl.accessToken=mapboxAccessToken();
   instance=new mapboxgl.Map({container:container.current,style:atlasStyleUri(),center:[-94.3619,35.2904],zoom:7,transformRequest:(url)=>client.transformTileRequest(url)??{url}});
   map.current=instance;instance.on('load',()=>{if(!disposed)setReady(true);});instance.on('error',()=>{if(!disposed)setPhase('TILE_OR_MAP_UNAVAILABLE');});
  }).catch(()=>{if(!disposed)setPhase('MAP_UNAVAILABLE');});
  return ()=>{disposed=true;removeFrame.current?.();removeFrame.current=null;map.current=null;instance?.remove();mapboxgl.maxParallelImageRequests=previousImageLimit;};
 },[active,session?.userId,!!session,expired,client]);
 useEffect(()=>{
  setFrame(null);setTracking(null);notify.current(null);setPhase(!session||expired?'AUTH_REQUIRED':'PENDING');
  if(!ready||!active||!session||expired||!map.current)return;
  const instance=map.current;let disposed=false;
  const selection=pilotSelection(product,site);
  const updates=createPilotFrameUpdates(instance,selection,(promoted:RadarFrame)=>{
   receivedAt.current=Date.now();setClock(Date.now());setFrame(promoted);notify.current(promoted);
  },setPhase);
  const removeAll=()=>updates.stop();removeFrame.current=removeAll;
  const polling=startVisibleRadarRefresh({load:(signal:AbortSignal)=>loadPilotFrame(client,selection,signal),onResult:async(result:{state:string;frame?:RadarFrame},signal:AbortSignal)=>{
   if(disposed)return;
   if(result.frame){updates.update(result.frame);const startedAt=performance.now(),snapshot=await loadTrackingSnapshot(client,selection,signal);if(!disposed&&!signal.aborted){trackingReceivedAt.current=startedAt;setTracking(snapshot);}}else{setTracking(null);setPhase(result.state);}
  }});
  refreshCurrent.current=polling.refresh;
  return ()=>{disposed=true;polling.stop();refreshCurrent.current=null;removeAll();if(removeFrame.current===removeAll)removeFrame.current=null;};
 },[ready,active,site,product,session?.userId,expired,client]);
 useEffect(()=>{
  const tick=()=>{if(!document.hidden)setClock(Date.now());};
  const timer=window.setInterval(tick,1000);document.addEventListener('visibilitychange',tick);
  return ()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
 },[]);
 const legend=metadataLegend(frame,product);
 const age=frame?currentRadarAge(frame,receivedAt.current,clock):null;
 return <div className="private-radar-pilot" aria-label="Private single-site radar pilot">
  <div className="private-radar-pilot-panel">
   <strong>{site} · {product} · CUT {product==='VEL'?2:1} · {phase}</strong>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'8px 0'}}>{['REF','VEL','CC'].map(value=><button style={{minHeight:40,minWidth:44}} key={value} type="button" aria-pressed={product===value} disabled={!session||expired||product===value} onClick={()=>{if(value===product)return;removeFrame.current?.();removeFrame.current=null;setFrame(null);notify.current(null);setPhase('PENDING');setProduct(value);}}>{value}</button>)} <button style={{minHeight:40}} type="button" disabled={!session||expired} onClick={()=>refreshCurrent.current?.()}>Refresh one frame</button></div>
   <div role="status" aria-live="polite">{frame?`${frame.frameId} · ${frame.time} · ${age}s old now · ${frame.freshness} at retrieval${age!==null&&age>120?" · IMAGE OVER 120s OLD":""}`:phase==='PENDING'?'Waiting for frame or authorized tiles.':phase}</div>
   <small>Checks every 30s while visible. New scans follow source cadence. {frame&&phase!==frame.freshness?`Keeping previous image; ${phase}.`:''}</small>
   {legend&&<div aria-label={`Frame legend ${legend.units}`}><div style={{height:12,background:legend.gradient}}/><span>{legend.min} — {legend.max} {legend.units}</span></div>}
   {site==='KSRX'&&product==='REF'&&session&&!expired&&<details><summary>Reflectivity region tracking (research)</summary><TrackingPanel snapshot={tracking} site={site} product={product} frameId={frame?.frameId??''} mode="LIVE_CLOCK_RESEARCH" elapsedMs={Math.max(0,performance.now()-trackingReceivedAt.current)}/></details>}
  </div>
  <div ref={container} className="private-radar-pilot-map" style={{visibility:session&&!expired?'visible':'hidden'}} />
 </div>;
}
