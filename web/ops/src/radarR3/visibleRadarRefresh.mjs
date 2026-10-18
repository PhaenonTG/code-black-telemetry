// One metadata read at a time; image loading remains the map's responsibility.
export function startVisibleRadarRefresh({load,onResult,visibility=document,setTimer=setTimeout,clearTimer=clearTimeout,intervalMs=30000,maxBackoffMs=120000}){
 let stopped=false,timer=null,inflight=null,failures=0,resumePending=false;
 const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
 const schedule=()=>{clear();if(!stopped&&!visibility.hidden)timer=setTimer(run,Math.min(maxBackoffMs,intervalMs*2**failures));};
 async function run(){
  clear();if(stopped||visibility.hidden)return;
  if(inflight){resumePending=true;return;}
  const controller=new AbortController();inflight=controller;
  try{
   const result=await load(controller.signal);
   if(stopped||visibility.hidden||controller.signal.aborted)return;
   failures=result.frame||result.state==='PENDING'?0:Math.min(failures+1,2);await onResult(result,controller.signal);
  }catch{if(!stopped&&!visibility.hidden&&!controller.signal.aborted){failures=Math.min(failures+1,2);onResult({state:'UNAVAILABLE'});}}
  finally{inflight=null;if(resumePending&&!stopped&&!visibility.hidden){resumePending=false;void run();}else schedule();}
 }
 const changed=()=>{clear();if(visibility.hidden){resumePending=false;inflight?.abort();}else{failures=0;void run();}};
 visibility.addEventListener('visibilitychange',changed);void run();
 return {refresh:()=>{if(!inflight)void run();},stop:()=>{stopped=true;clear();inflight?.abort();visibility.removeEventListener('visibilitychange',changed);}};
}
export function currentRadarAge(frame,receivedAt,now=Date.now()){
 return Math.max(0,Math.floor(frame.ageSeconds+Math.max(0,now-receivedAt)/1000),Math.floor((now-Date.parse(frame.time))/1000));
}
