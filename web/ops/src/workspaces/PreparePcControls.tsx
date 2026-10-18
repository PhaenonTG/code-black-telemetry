import {useCallback,useEffect,useState} from "react"
import {currentAccessToken} from "../core/client"
import {readProducerResponse} from "./producerResponse"
import {producerReadAllowed} from "./producerRateLimit"
import {canPrepare,preparationPending,type PcLauncher} from "./pcPreparation"
import "./pc-preparation.css"
async function api<T>(method="GET",body?:unknown):Promise<T>{
 const token=await currentAccessToken();if(!token)throw Error("Sign in to OPS again.")
 const response=await fetch(`/api/producer/v1/launcher${method==="POST"?"/prepare":""}`,{method,cache:"no-store",headers:{Authorization:`Bearer ${token}`,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)})
 return readProducerResponse<T>(response)
}
export default function PreparePcControls(){
 const [doc,setDoc]=useState<PcLauncher|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false),[message,setMessage]=useState("")
 const pending=preparationPending(doc)
 const refresh=useCallback(async()=>{try{const next=await api<PcLauncher>();if(!next.online||next.controlAccess?.allowed!==true)setConfirm(false);setDoc(next);setError("")}catch(e){setDoc(null);setConfirm(false);setError(e instanceof Error?e.message:"Preparation helper unavailable")}},[])
 useEffect(()=>{const initial=window.setTimeout(()=>void refresh(),0);const timer=window.setInterval(()=>{if(!document.hidden&&producerReadAllowed())void refresh()},pending?5000:30000);return()=>{window.clearTimeout(initial);window.clearInterval(timer)}},[refresh,pending])
 async function request(action:"prepare"|"check"){
  setBusy(true);setConfirm(false)
  try{await api("POST",{requestId:crypto.randomUUID(),confirmed:true,action});setMessage("Request queued. Waiting for PHAENON3; typically up to 30 seconds. No automatic retry.");await refresh()}
  catch(e){setMessage(e instanceof Error?e.message:"Delivery unconfirmed. Check status; do not retry blindly.");await refresh()}
  finally{setBusy(false)}
 }
 const result=doc?.last?.result
 return <section className="pc-prepare" aria-label="Prepare streaming PC">
  <header><div><h3>Prepare streaming PC</h3><p>PHAENON3 · existing Nick OBS / Fieldline setup</p></div><strong>{doc?.online?"HELPER ONLINE":"HELPER OFFLINE / UNKNOWN"}</strong></header>
  <p>Opens OBS and starts missing support components. Never starts Facebook, YouTube, or recording; never restarts running components.</p>
  {error&&<p role="alert">{error}</p>}
  {!doc?.online&&<p>The PC must be on, with the Windows helper running. This cannot wake an offline PC.</p>}
  {doc?.controlAccess?.allowed===false&&<p>Remote preparation is restricted to approved producer accounts.</p>}
  <div className="pc-prepare__actions"><button type="button" disabled={!canPrepare(doc,busy)} onClick={()=>setConfirm(true)}>Prepare PC…</button><button type="button" disabled={!doc?.online||!doc.controlAccess?.allowed||busy||pending} onClick={()=>void request("check")}>Check PC only</button><button type="button" disabled={busy} onClick={()=>void refresh()}>Refresh PC status</button></div>
  {confirm&&<div role="alertdialog" aria-label="Confirm PC preparation"><p>Run the fixed preparation script on PHAENON3? It may open OBS and start missing local services. It will not start either public output.</p><button type="button" disabled={!canPrepare(doc,busy)} onClick={()=>void request("prepare")}>Confirm prepare PC</button><button type="button" onClick={()=>setConfirm(false)}>Cancel</button></div>}
  <p role="status">{!pending&&doc?.last&&message.startsWith("Request queued")?"Request finished; see the last check below.":message}{doc?.last?` Last ${doc.last.action??"preparation"}: ${doc.last.state.toUpperCase()}.`:""}</p>
  {doc?.last?.state==="unknown"&&<p role="alert">Previous delivery is uncertain. Use Check PC only and verify OBS before requesting preparation again.</p>}
  {result&&<div className="pc-prepare__results" aria-label="Last PC health check"><span>PC: <b>{result.pcReady?"READY":"NEEDS ATTENTION"}</b></span><span>Camera/audio: <b>{result.feedReady?"READY":"WAITING"}</b></span><span>Both outputs: <b>{result.outputsOff?"OFF":"VERIFY IN OBS"}</b></span><span>YouTube key: <b>{result.youtubeConfigured?"CONFIGURED":"PENDING"}</b></span></div>}
  {doc?.last?.completedAt&&<small>Last check {new Date(doc.last.completedAt).toLocaleString()} · preparation is not authorization to go live.</small>}
 </section>
}
