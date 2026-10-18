import {useEffect,useState} from 'react'
import {useAuth} from '../../auth/AuthProvider'
import {useCoreOps} from '../../core/useCoreOps'
import {buildCoreRequestHeaders,currentAccessToken} from '../../core/client'
import {InventorySections,type InventoryDocument} from './InventorySections'

// Candidate remains inactive until separate route/audience/publication approval.
const ACTIVATED=true
export default function OperationalInventory(){
 const auth=useAuth(),{config}=useCoreOps()
 const allowed=ACTIVATED&&auth.status==='authorized'&&auth.profile.active&&['OWNER','ADMIN'].includes(auth.profile.role)
 const userId=auth.status==='authorized'?auth.session.user.id:null
 const [document,setDocument]=useState<InventoryDocument|null>(null),[error,setError]=useState<string|null>(null)
 useEffect(()=>{
  setDocument(null);setError(null);if(!allowed)return
  let stopped=false,timer:ReturnType<typeof setTimeout>|null=null,inflight:AbortController|null=null
  const refresh=async()=>{
   if(stopped||globalThis.document.hidden||inflight)return
   const abort=new AbortController();inflight=abort
   const deadline=setTimeout(()=>abort.abort(),10000)
   try{
    const token=await currentAccessToken();if(abort.signal.aborted||stopped)return
    const response=await fetch(config.coreBaseUrl+'/api/ops/status-center/v1/inventory',{headers:buildCoreRequestHeaders(token),cache:'no-store',signal:abort.signal})
    if(!response.ok){if(response.status===401||response.status===403)setDocument(null);throw Error('UNAVAILABLE')}
    if(!response.headers.get('content-type')?.includes('application/json'))throw Error('INVALID')
    const text=await response.text();if(text.length>262144)throw Error('OVERSIZE')
    const value=JSON.parse(text)
    if(value.schema!=='codeblack.ops.inventory.v1'||!['projects','hosts','services','links'].every(k=>Array.isArray(value[k])&&value[k].length<=512))throw Error('INVALID')
    if(value.documents!==undefined&&(!Array.isArray(value.documents)||value.documents.length>32||value.documents.some((item:Record<string,unknown>)=>!item||item.classification!=='CODEBLACK'||!['id','name','host','project_id','local_path','version','owner','status','sha256','verified_at','verification'].every(key=>typeof item[key]==='string'&&(item[key] as string).length<=500))))throw Error('INVALID_DOCUMENTS')
    if(!stopped&&!abort.signal.aborted){setDocument(value);setError(null)}
   }catch{if(!stopped)setError('UNAVAILABLE')}
   finally{clearTimeout(deadline);inflight=null;if(!stopped&&!globalThis.document.hidden)timer=setTimeout(refresh,30000)}
  }
  const changed=()=>{if(timer)clearTimeout(timer);timer=null;if(!globalThis.document.hidden)void refresh()}
  globalThis.document.addEventListener('visibilitychange',changed);void refresh()
  return()=>{stopped=true;if(timer)clearTimeout(timer);inflight?.abort();globalThis.document.removeEventListener('visibilitychange',changed)}
 },[allowed,userId,config.coreBaseUrl])
 if(!allowed)return null
 return <InventorySections document={document} error={error}/>
}
