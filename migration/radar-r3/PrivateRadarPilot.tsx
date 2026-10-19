import {useEffect,useMemo,useRef,useState} from 'react';
import mapboxgl, {type Map as MapboxMap} from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './PrivateRadarPilot.css';
import {atlasStyleUri,ensureMapboxAccessToken,mapboxAccessToken} from '../../../../src/services/mapTiles';
import type {RadarFrame} from '../../../../src/services/radar';
import {createPrivateRadarClient,pilotSelection,metadataLegend} from './privateRadarClient.mjs';
import {loadPilotFrame,mountPilotFrame} from './privateRadarPilot.mjs';

type Session={userId:string;accessToken:string;expiresAtMs:number}|null;
export function PrivateRadarPilot({active,session,onFrame}:{active:boolean;session:Session;onFrame:(frame:RadarFrame|null)=>void}){
 const container=useRef<HTMLDivElement>(null),map=useRef<MapboxMap|null>(null),currentSession=useRef(session),notify=useRef(onFrame),removeFrame=useRef<(()=>void)|null>(null);
 currentSession.current=session;notify.current=onFrame;
 const [expired,setExpired]=useState(false),[ready,setReady]=useState(false),[product,setProduct]=useState('REF'),[refresh,setRefresh]=useState(0),[phase,setPhase]=useState('PENDING'),[frame,setFrame]=useState<RadarFrame|null>(null);
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
  void ensureMapboxAccessToken().then(available=>{
   if(disposed)return;if(!available||!container.current){setPhase('MAP_UNAVAILABLE');return;}
   mapboxgl.accessToken=mapboxAccessToken();
   instance=new mapboxgl.Map({container:container.current,style:atlasStyleUri(),center:[-94.3619,35.2904],zoom:7,transformRequest:(url)=>client.transformTileRequest(url)??{url}});
   map.current=instance;instance.on('load',()=>{if(!disposed)setReady(true);});instance.on('error',()=>{if(!disposed){removeFrame.current?.();removeFrame.current=null;setPhase('TILE_OR_MAP_UNAVAILABLE');setFrame(null);notify.current(null);}});
  }).catch(()=>{if(!disposed)setPhase('MAP_UNAVAILABLE');});
  return ()=>{disposed=true;removeFrame.current?.();removeFrame.current=null;map.current=null;instance?.remove();};
 },[active,session?.userId,!!session,expired,client]);
 useEffect(()=>{
  setFrame(null);notify.current(null);setPhase(!session||expired?'AUTH_REQUIRED':'PENDING');
  if(!ready||!active||!session||expired||!map.current)return;
  const controller=new AbortController(),instance=map.current;let remove:(()=>void)|undefined,disposed=false;
  const selection=pilotSelection(product);
  void loadPilotFrame(client,selection,controller.signal).then(result=>{
   if(disposed)return;setPhase(result.state);
   if(result.frame){remove=mountPilotFrame(instance,result.frame,selection,(promoted:RadarFrame)=>{if(!disposed){setFrame(promoted);setPhase(promoted.freshness);notify.current(promoted);}});removeFrame.current=remove;}
  }).catch(()=>{if(!disposed)setPhase('UNAVAILABLE');});
  return ()=>{disposed=true;controller.abort();remove?.();if(removeFrame.current===remove)removeFrame.current=null;};
 },[ready,active,product,refresh,session?.accessToken,expired,client]);
 const legend=metadataLegend(frame,product);
 return <div style={{position:'relative',height:'100%',minHeight:340}} aria-label="Private single-site radar pilot">
  <div ref={container} style={{position:'absolute',inset:0,visibility:session&&!expired?'visible':'hidden'}} />
  <div className="private-radar-pilot-panel">
   <strong>KSRX · {product} · CUT {product==='VEL'?2:1} · {phase}</strong>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'8px 0'}}>{['REF','VEL','CC'].map(value=><button style={{minHeight:40,minWidth:44}} key={value} type="button" aria-pressed={product===value} disabled={!session||expired||product===value} onClick={()=>{if(value===product)return;removeFrame.current?.();removeFrame.current=null;setFrame(null);notify.current(null);setPhase('PENDING');setProduct(value);}}>{value}</button>)} <button style={{minHeight:40}} type="button" disabled={!session||expired} onClick={()=>setRefresh(value=>value+1)}>Refresh one frame</button></div>
   <div role="status" aria-live="polite">{frame?`${frame.frameId} · ${frame.time} · ${frame.ageSeconds}s old at retrieval · ${frame.freshness}`:phase==='PENDING'?'Waiting for frame or authorized tiles; refresh to check again.':phase}</div>
   {legend&&<div aria-label={`Frame legend ${legend.units}`}><div style={{height:12,background:legend.gradient}}/><span>{legend.min} — {legend.max} {legend.units}</span></div>}
  </div>
 </div>;
}
