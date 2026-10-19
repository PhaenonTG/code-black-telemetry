export function visibleSnapshotPoller({load,onData,onError,visibility=document,setTimer=setTimeout,clearTimer=clearTimeout,intervalMs=60000}){
 let stopped=false,timer=null,inflight=null,resume=false,failures=0;
 const clear=()=>{if(timer!==null)clearTimer(timer);timer=null};
 async function run(){
  clear();if(stopped||visibility.hidden)return;if(inflight){resume=true;return}
  const controller=new AbortController();inflight=controller;
  try{const data=await load(controller.signal);if(!stopped&&!visibility.hidden&&!controller.signal.aborted){failures=0;onData(data)}}
  catch(error){if(!stopped&&!visibility.hidden&&!controller.signal.aborted){failures=Math.min(failures+1,2);onError(error)}}
  finally{inflight=null;if(stopped||visibility.hidden)return;if(resume){resume=false;void run()}else timer=setTimer(run,Math.min(240000,intervalMs*2**failures))}
 }
 const changed=()=>{clear();if(visibility.hidden){resume=false;inflight?.abort()}else{failures=0;void run()}};
 visibility.addEventListener('visibilitychange',changed);void run();
 return {refresh:()=>{if(!inflight)void run()},stop:()=>{stopped=true;clear();inflight?.abort();visibility.removeEventListener('visibilitychange',changed)}}
}
