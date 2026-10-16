import type { BridgeStorage } from "./producer-bridge";
const KEY="pc-launcher-v1";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Result={pcReady:boolean;feedReady:boolean;outputsOff:boolean;facebookConfigured:boolean;youtubeConfigured:boolean};
type Job={requestId:string;action:"prepare"|"check";createdAt:number;operator:string;state:"queued"|"delivered"|"succeeded"|"failed"|"unknown";result?:Result;completedAt?:number};
type Document={heartbeatAt?:number;instanceId?:string;version?:string;jobs:Job[]};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const active=(job:Job)=>job.state==="queued"||job.state==="delivered";
function cleanResult(raw:unknown):Result|undefined {if(!raw||typeof raw!=="object")return;const value=raw as Record<string,unknown>,keys=["pcReady","feedReady","outputsOff","facebookConfigured","youtubeConfigured"] as const;if(keys.some(k=>typeof value[k]!=="boolean")||Object.keys(value).length!==keys.length)return;return Object.fromEntries(keys.map(k=>[k,value[k]])) as Result;}
export async function handlePcLauncher(request:Request,storage:BridgeStorage):Promise<Response|null>{
 const path=new URL(request.url).pathname;
 const poll=path==="/api/producer/v1/workstation/launcher/poll";
 if(!poll&&path!=="/api/producer/v1/launcher"&&path!=="/api/producer/v1/launcher/prepare")return null;
 if((poll||path.endsWith("/prepare"))?request.method!=="POST":request.method!=="GET")return json(405,{error:"METHOD_NOT_ALLOWED"});
 let body:Record<string,unknown>={};if(request.method==="POST"){const text=await request.text();if(text.length>4096)return json(413,{error:"REQUEST_TOO_LARGE"});try{body=JSON.parse(text);if(!body||Array.isArray(body)||typeof body!=="object")throw Error();}catch{return json(400,{error:"INVALID_REQUEST"});}}
 const now=Date.now(),doc=await storage.get<Document>(KEY)??{jobs:[]};
 let changed=false;for(const job of doc.jobs)if(active(job)&&now-job.createdAt>120000){job.state="unknown";changed=true;}
 if(poll){
  if(!UUID.test(String(body.instanceId??""))||typeof body.version!=="string"||!/^[a-z0-9._-]{1,40}$/i.test(body.version)||Object.keys(body).some(k=>!["instanceId","version","ack"].includes(k)))return json(400,{error:"INVALID_LAUNCHER_POLL"});
  if(doc.instanceId&&doc.instanceId!==body.instanceId&&now-(doc.heartbeatAt??0)<75000)return json(409,{error:"LAUNCHER_INSTANCE_ACTIVE"});
  const ack=body.ack as Record<string,unknown>|undefined;
  if(ack){const result=cleanResult(ack.result);if(Object.keys(ack).some(k=>!["requestId","state","result"].includes(k))||!UUID.test(String(ack.requestId??""))||!["succeeded","failed","unknown"].includes(String(ack.state))||!result)return json(400,{error:"INVALID_LAUNCHER_ACK"});const job=doc.jobs.find(j=>j.requestId===ack.requestId);if(job?.state==="delivered"){job.state=ack.state as Job["state"];job.result=result;job.completedAt=now;}}
  doc.heartbeatAt=now;doc.instanceId=body.instanceId as string;doc.version=body.version;
  const job=doc.jobs.find(j=>j.state==="queued");if(job)job.state="delivered";
  await storage.put(KEY,doc);
  return json(200,{command:job?{requestId:job.requestId,action:job.action,createdAt:job.createdAt}:null,pollAfterMs:30000});
 }
 const online=typeof doc.heartbeatAt==="number"&&now-doc.heartbeatAt<=75000;
 if(request.method==="GET"){if(changed)await storage.put(KEY,doc);return json(200,{host:"PHAENON3",online,observedAt:doc.heartbeatAt?new Date(doc.heartbeatAt).toISOString():null,version:doc.version??null,last:doc.jobs.at(-1)??null});}
 const user=request.headers.get("X-Producer-UserId");if(!user)return json(403,{error:"PRODUCER_CONTROL_FORBIDDEN"});
 const action=body.action??"prepare";
 if(Object.keys(body).some(k=>!["requestId","confirmed","action"].includes(k))||!["prepare","check"].includes(String(action))||body.confirmed!==true||!UUID.test(String(body.requestId??"")))return json(400,{error:"CONFIRMATION_REQUIRED"});
 const prior=doc.jobs.find(j=>j.requestId===body.requestId);if(prior)return prior.action===action?json(200,{request:prior,duplicate:true}):json(409,{error:"REQUEST_ID_CONFLICT"});
 if(!online)return json(409,{error:"PC_HELPER_OFFLINE"});
 if(doc.jobs.some(active))return json(409,{error:"PREPARATION_PENDING"});
 const latest=doc.jobs.at(-1);if(latest?.state==="unknown"&&action!=="check")return json(409,{error:"VERIFY_PC_AFTER_UNKNOWN_RESULT"});
 if(latest&&now-latest.createdAt<(action==="check"?10000:60000))return json(429,{error:"PREPARATION_COOLDOWN"});
 const job:Job={requestId:body.requestId as string,action:action as Job["action"],createdAt:now,operator:(request.headers.get("X-Producer-Operator")??"Producer").slice(0,64),state:"queued"};
 doc.jobs.push(job);doc.jobs=doc.jobs.slice(-100);await storage.put(KEY,doc);
 return json(202,{request:job});
}
