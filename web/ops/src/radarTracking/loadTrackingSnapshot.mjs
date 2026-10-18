import {projectTrackingResearch} from '../../../../shared/trackingResearchContract.mjs';
// Invoked serially by the existing visible radar refresh owner, never by rendering.
export async function loadTrackingSnapshot(client,selection,signal){
 if(selection.site!=='KSRX'||selection.product!=='REF'||selection.cut!==1)return null;
 const response=await client.read('/api/ops-radar/v1/tracks?site=KSRX&product=REF&tilt=1',{signal});
 if(response.state!=='RECEIVED'||signal?.aborted)return null;
 try{return projectTrackingResearch(response.data)}catch{return null}
}
