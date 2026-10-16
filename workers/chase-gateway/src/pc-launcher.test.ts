import {describe,it,expect,vi} from "vitest";
import {handlePcLauncher} from "./pc-launcher";
import {handleRequest,type Env} from "./index";
import type {BridgeStorage} from "./producer-bridge";
class Memory implements BridgeStorage{map=new Map<string,unknown>();async get<T>(key:string){return structuredClone(this.map.get(key)) as T|undefined;}async put<T>(key:string,value:T){this.map.set(key,structuredClone(value));}}
const call=(db:Memory,path:string,body?:unknown,user="approved")=>handlePcLauncher(new Request("https://x/api/producer/v1/"+path,{method:body===undefined?"GET":"POST",headers:{...(user?{"X-Producer-UserId":user}:{}),"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})}),db);
type Payload={duplicate:boolean;command:{action:string}|null;last:{state:string}};
const payload=async(response:Promise<Response|null>)=>await(await response)!.json() as Payload;
const poll=()=>({instanceId:crypto.randomUUID(),version:"pc-prepare-v1"});
describe("fixed PC preparation queue",()=>{
 it("requires helper heartbeat, actor and explicit confirmation; rejects commands/paths",async()=>{
  const db=new Memory();
  expect((await call(db,"launcher/prepare",{requestId:crypto.randomUUID(),confirmed:true}))!.status).toBe(409);
  await call(db,"workstation/launcher/poll",poll());
  expect((await call(db,"launcher/prepare",{requestId:crypto.randomUUID(),confirmed:true},""))!.status).toBe(403);
  expect((await call(db,"launcher/prepare",{requestId:crypto.randomUUID(),confirmed:false}))!.status).toBe(400);
  expect((await call(db,"launcher/prepare",{requestId:crypto.randomUUID(),confirmed:true,script:"evil"}))!.status).toBe(400);
 });
 it("delivers once, deduplicates requests and exposes only bounded readiness results",async()=>{
  const db=new Memory(),p=poll(),requestId=crypto.randomUUID();await call(db,"workstation/launcher/poll",p);
  expect((await call(db,"launcher/prepare",{requestId,confirmed:true}))!.status).toBe(202);
  expect((await payload(call(db,"launcher/prepare",{requestId,confirmed:true}))).duplicate).toBe(true);
  expect((await payload(call(db,"workstation/launcher/poll",p))).command?.action).toBe("prepare");
  expect((await payload(call(db,"workstation/launcher/poll",p))).command).toBe(null);
  expect((await call(db,"launcher/prepare",{requestId:crypto.randomUUID(),confirmed:true}))!.status).toBe(409);
  await call(db,"workstation/launcher/poll",{...p,ack:{requestId,state:"succeeded",result:{pcReady:true,feedReady:false,outputsOff:true,facebookConfigured:true,youtubeConfigured:false}}});
  expect((await payload(call(db,"launcher"))).last.state).toBe("succeeded");
 });
 it("rejects competing helpers and arbitrary output in acknowledgments",async()=>{
  const db=new Memory(),p=poll();await call(db,"workstation/launcher/poll",p);
  expect((await call(db,"workstation/launcher/poll",poll()))!.status).toBe(409);
  expect((await call(db,"workstation/launcher/poll",{...p,ack:{requestId:crypto.randomUUID(),state:"succeeded",result:{secret:"no"}}}))!.status).toBe(400);
 });
 it("expires delivery to unknown; only a new read-only check is allowed",async()=>{
  const db=new Memory(),p=poll();await call(db,"workstation/launcher/poll",p);
  await call(db,"launcher/prepare",{requestId:crypto.randomUUID(),confirmed:true});await call(db,"workstation/launcher/poll",p);
  const doc=db.map.get("pc-launcher-v1") as {jobs:Array<{createdAt:number}>};doc.jobs[0].createdAt=Date.now()-121000;
  expect((await payload(call(db,"launcher"))).last.state).toBe("unknown");
  expect((await call(db,"launcher/prepare",{requestId:crypto.randomUUID(),confirmed:true}))!.status).toBe(409);
  expect((await call(db,"launcher/prepare",{requestId:crypto.randomUUID(),confirmed:true,action:"check"}))!.status).toBe(202);
 });
 it("public routes authenticate even when internal headers are spoofed",async()=>{
  const env={PRODUCER_BRIDGE:{},PRODUCER_BRIDGE_TOKEN:"private"} as Env;
  for(const path of ["launcher","launcher/prepare","workstation/launcher/poll"]){
   const response=await handleRequest(new Request("https://ops.codeblackwx.com/api/producer/v1/"+path,{method:path==="launcher"?"GET":"POST",headers:{"X-Producer-UserId":"spoofed"}}),env);
   expect(response.status).toBe(401);
  }
 });
 it("a signed-in but unapproved user cannot prepare the PC",async()=>{
  const mock=vi.spyOn(globalThis,"fetch").mockImplementation(async input=>String(input).includes('/auth/v1/user')?Response.json({id:"read-only-user"}):Response.json([{active:true,operator_name:"Viewer"}]));
  try{
   const env={PRODUCER_BRIDGE:{},SUPABASE_URL:"https://example.invalid",SUPABASE_PUBLISHABLE_KEY:"public-test-key",PRODUCER_CONTROLS_ENABLED:"true",PRODUCER_OPERATOR_IDS:"different-approved-user"} as Env;
   const response=await handleRequest(new Request("https://ops.codeblackwx.com/api/producer/v1/launcher/prepare",{method:"POST",headers:{Authorization:"Bearer test-session"}}),env);
   expect(response.status).toBe(403);
  }finally{mock.mockRestore();}
 });
});
