import {visibleSnapshotPoller} from './visibleSnapshotPoller.mjs'
import {useEffect,useRef,useState} from 'react'
import {useAuth} from '../auth/AuthProvider'
import {currentAccessToken,buildCoreRequestHeaders} from '../core/client'
import './siteDirectory.css'
import {DirectoryContent,type DirectoryDocument} from './siteDirectoryView'
export default function SiteDirectory(){
 const auth=useAuth(),userId=auth.status==='authorized'?auth.session.user.id:null
 const [document,setDocument]=useState<DirectoryDocument|null>(null),[error,setError]=useState<string|null>(null)
 const refreshCurrent=useRef<(()=>void)|null>(null)
 useEffect(()=>{
  setDocument(null);setError(null);if(!userId)return
  const polling=visibleSnapshotPoller({load:async(signal:AbortSignal)=>{
   const controller=new AbortController(),cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();const deadline=setTimeout(cancel,10000)
   try{
    const token=await currentAccessToken();if(controller.signal.aborted)throw Error('CANCELLED')
    const response=await fetch('/api/directory',{headers:buildCoreRequestHeaders(token),cache:'no-store',credentials:'omit',signal:controller.signal})
    if(!response.ok)throw Error(response.status===401||response.status===403?'AUTH_REQUIRED':'UNAVAILABLE')
    if(!response.headers.get('content-type')?.includes('application/json'))throw Error('INVALID_SOURCE')
    const body=await response.text();if(body.length>262144)throw Error('INVALID_SOURCE')
    const value=JSON.parse(body);if(value.schema!=='codeblack.directory.v1'||!Array.isArray(value.entries)||value.entries.length>128)throw Error('INVALID_SOURCE')
    for(const row of value.entries){if(typeof row.id!=='string'||typeof row.name!=='string')throw Error('INVALID_SOURCE');if(row.url){const u=new URL(row.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search)throw Error('INVALID_SOURCE')}}
    return value
   }finally{clearTimeout(deadline);signal.removeEventListener('abort',cancel)}
  },onData:(value:DirectoryDocument)=>{setDocument(value);setError(null)},onError:(reason:Error)=>{
   if(reason.message==='AUTH_REQUIRED'){setDocument(null);setError('Your active OPS session is required to view these links.')}
   else setError('Directory source unavailable; any previous snapshot retains its original timestamp.')
  }})
  refreshCurrent.current=polling.refresh;return()=>{polling.stop();refreshCurrent.current=null}
 },[userId])
 useEffect(()=>{
  const links=['splash.css','adapter.css'].map(file=>{const link=window.document.createElement('link');link.rel='stylesheet';link.href='/directory-assets/'+file;window.document.head.append(link);return link})
  const script=window.document.createElement('script');script.src='/directory-assets/splash.js';window.document.body.append(script)
  return()=>{
   script.remove();links.forEach(link=>link.remove());window.document.querySelector('.cb-splash')?.remove()
   const descriptor=Object.getOwnPropertyDescriptor(window,'replaySplash')
   // Older classic scripts created a non-configurable Window function. Neutralize
   // that writable legacy property; delete only configurable registrations.
   if(descriptor?.configurable)Reflect.deleteProperty(window,'replaySplash')
   else if(descriptor?.writable)(window as Window&{replaySplash?:()=>void}).replaySplash=undefined
  }
 },[])
 return <DirectoryContent document={document} error={error} onRefresh={()=>refreshCurrent.current?.()}/>
}
