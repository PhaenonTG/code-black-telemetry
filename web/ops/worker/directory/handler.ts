import {verifyOpsAuth,forwardToCore,resolveAllowlistRoute,type GatewayEnv} from '../../functions/lib/coreGateway'
const headers={'Cache-Control':'private, no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff'}
export async function handleDirectory(request:Request,env:GatewayEnv,fetchImpl:typeof fetch=fetch):Promise<Response>{
 const url=new URL(request.url)
 if(url.pathname!=='/api/directory'||url.search)return Response.json({error:'NOT_FOUND'},{status:404,headers})
 if(request.method!=='GET')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405,headers})
 const controller=new AbortController(),cancel=()=>controller.abort()
 request.signal.addEventListener('abort',cancel,{once:true});if(request.signal.aborted)cancel()
 const timer=setTimeout(cancel,8000)
 try{
  const cancelled=new Promise<never>((_,reject)=>{if(controller.signal.aborted)reject(Error('cancelled'));else controller.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true})})
  const auth=await Promise.race([verifyOpsAuth(request.headers.get('Authorization'),env,(input,init)=>fetchImpl(input,{...init,signal:controller.signal})),cancelled])
  if(!auth.ok)return Response.json({error:auth.reason},{status:auth.status,headers})
  if(!auth.role||!['OWNER','ADMIN','OPERATOR'].includes(auth.role))return Response.json({error:'UNAUTHORIZED'},{status:403,headers})
  const route=resolveAllowlistRoute('api/ops/directory/v1/snapshot')
  if(!route)return Response.json({error:'DIRECTORY_NOT_CONFIGURED'},{status:503,headers})
  const result=await forwardToCore(route,new URL('https://ops-internal.invalid/api/ops/directory/v1/snapshot'),env,(input,init)=>fetchImpl(input,{...init,signal:controller.signal}),{method:'GET',headers:{'X-Ops-User-Id':auth.userId,'X-Ops-Role':auth.role}})
  if(result.status!==200)return Response.json({error:'DIRECTORY_SOURCE_UNAVAILABLE'},{status:503,headers})
  const data=result.body as Record<string,unknown>|undefined
  const allowed=['schema','generated_at','source_revision','update_mode','update_note','feed_state','sources','entries']
  if(!data||data.schema!=='codeblack.directory.v1'||Object.keys(data).some(key=>!allowed.includes(key))||!Array.isArray(data.entries)||data.entries.length>128)return Response.json({error:'DIRECTORY_INVALID_SOURCE'},{status:502,headers})
  return Response.json(data,{headers})
 }catch{return Response.json({error:controller.signal.aborted?'AUTH_TIMEOUT':'AUTH_UNAVAILABLE'},{status:503,headers})}
 finally{clearTimeout(timer);controller.abort();request.signal.removeEventListener('abort',cancel)}
}
