// Adapt the existing visible poller to both document and retained Setup Review tab visibility.
export function outlookVisibility(doc:Pick<Document,'hidden'|'visibilityState'|'addEventListener'|'removeEventListener'>,panel:Element|null,Observer:typeof MutationObserver=MutationObserver){
 const events=new EventTarget()
 const changed=()=>events.dispatchEvent(new Event('visibilitychange'))
 doc.addEventListener('visibilitychange',changed)
 const observer=panel?new Observer(changed):null
 if(panel)observer?.observe(panel,{attributes:true,attributeFilter:['hidden']})
 return{
  get hidden(){return doc.hidden||doc.visibilityState==='hidden'||!!panel?.hasAttribute('hidden')},
  addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),
  stop(){observer?.disconnect();doc.removeEventListener('visibilitychange',changed)},
 }
}
