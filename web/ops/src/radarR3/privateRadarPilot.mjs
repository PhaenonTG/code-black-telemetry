import {acceptedFrameView,metadataLegend} from './privateRadarClient.mjs';
export async function loadPilotFrame(client,selection,signal){
 const query=new URLSearchParams({site:selection.site,product:selection.product,tilt:String(selection.cut),limit:'1'});
 const result=await client.read('/api/ops-radar/v1/frames?'+query,{signal});
 if(result.state!=='RECEIVED')return result;
 const frame=Array.isArray(result.data)&&result.data.length===1?result.data[0]:null;
 if(acceptedFrameView(frame,selection,frame?.frameId).state==='UNAVAILABLE'||!metadataLegend(frame,selection.product))return {state:'UNAVAILABLE'};
 return {state:'PENDING',frame};
}
// Keep the last rendered source until a new identity has loaded real tiles.
export function createPilotFrameUpdates(map,selection,onFrame,onState){
 let stopped=false,acceptedId=null,pendingId=null,removeAccepted=null,removePending=null;
 return {
  update(frame){
   if(stopped)return;
   if(frame.frameId===acceptedId){onFrame(frame);onState(frame.freshness);return;}
   if(frame.frameId===pendingId)return;
   removePending?.();removePending=null;pendingId=frame.frameId;onState('PENDING');
   removePending=mountPilotFrame(map,frame,selection,promoted=>{
    if(stopped||pendingId!==promoted.frameId)return;
    removeAccepted?.();removeAccepted=removePending;removePending=null;pendingId=null;acceptedId=promoted.frameId;
    onFrame(promoted);onState(promoted.freshness);
   });
  },
  stop(){stopped=true;removePending?.();removePending=null;removeAccepted?.();removeAccepted=null;}
 };
}
export function mountPilotFrame(map,frame,selection,onPromoted){
 const result=acceptedFrameView(frame,selection,frame?.frameId);
 if(!result.frame||!metadataLegend(frame,selection.product))throw Error('Invalid radar frame');
 const id='private-radar-'+frame.frameId;let live=true,promoted=false;
 // Mapbox tile completion carries coord; initial metadata/content events do not.
 const promote=(event)=>{if(!live||promoted||event?.sourceId!==id||!event.coord||event.isSourceLoaded!==true||!map.isSourceLoaded(id))return;promoted=true;map.setPaintProperty(id,'raster-opacity',0.72);onPromoted(result.frame);};
 try{
  const b=frame.bounds;
  map.addSource(id,{type:'raster',tiles:[result.frame.tileTemplate],tileSize:256,maxzoom:16,
   ...(b?{bounds:[b.west,b.south,b.east,b.north]}:{})});
  map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':0,'raster-resampling':'nearest','raster-fade-duration':0}});
  map.on('sourcedata',promote);
 }catch(error){live=false;map.off('sourcedata',promote);if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id);throw error;}
 return ()=>{if(!live)return;live=false;map.off('sourcedata',promote);if(map.getLayer(id))map.removeLayer(id);if(map.getSource(id))map.removeSource(id);};
}
