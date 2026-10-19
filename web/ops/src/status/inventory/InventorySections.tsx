import './inventory.css'
export interface InventoryDocument {
 schema:'codeblack.ops.inventory.v1'; generated_at:string; source_generated_at:string|null; source_revision:string|null; policy_revision:string; freshness:string;
 projects:Array<{id:string;name:string;phase:string;health:string;deployment:string;serviceKeys:string[];lifecycle:string;source_present:boolean}>;
 hosts:Array<{id:string;name:string;state:string;last_contact:string|null;freshness:string;cpu_percent:number|null;memory_percent:number|null;collector:string;lifecycle:string;source_present:boolean}>;
 services:Array<{key:string;id:string;host:string;name:string;state:string;version:string|null;last_success:string|null;observed_at?:string|null;dependencies:string[];lifecycle:string;source_present:boolean}>;
 links:Array<{id:string;name:string;url:string|null;approval:string;verified_at:string|null;verification:string;lifecycle:string}>;
 documents?:Array<{id:string;name:string;host:string;project_id:string;local_path:string;version:string;owner:string;status:string;sha256:string;verified_at:string;verification:string;classification:'CODEBLACK'}>;
 documents_state?:string; documents_generated_at?:string|null;
}
const when=(value:string|null)=>value??'Not observed'
function safeLink(value:string|null){if(!value)return null;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash?u.href:null}catch{return null}}

function ProjectAreas({projects}:{projects:InventoryDocument['projects']}) { return <div className="ops-inventory__projects">{projects.map(p=><article key={p.id}><h4>{p.name}</h4><dl><dt>Declared phase</dt><dd>{p.phase}</dd><dt>Observed health</dt><dd>{p.health}</dd><dt>Deployment</dt><dd>{p.deployment}</dd><dt>Registered services</dt><dd>{p.serviceKeys.length}</dd></dl>{!p.source_present&&<p>Source entry not observed; retained for review.</p>}{p.lifecycle!=='RETAINED'&&<p>{p.lifecycle} — references preserved.</p>}</article>)}</div> }
const observedHealth = (health:string) => !['UNKNOWN','UNVERIFIED','NO_DATA','NOT_MONITORED','NOT_CONFIGURED','CHECKING','PENDING',''].includes(health.toUpperCase())
export function InventorySections({document,error}:{document:InventoryDocument|null;error:string|null}){
 if(!document)return <section aria-label="Operational inventory"><h2>OPERATIONAL INVENTORY</h2><p role="status">{error?'Operational inventory unavailable. Existing Status Center remains available.':'Loading authorized operational inventory.'}</p></section>
 const monitored = (p:InventoryDocument['projects'][number]) => observedHealth(p.health) || document.services.some(s=>p.serviceKeys.includes(s.key)&&observedHealth(s.state))
 return <section className="ops-inventory" aria-label="Operational inventory">
  <h2>OPERATIONAL INVENTORY</h2>
  <p>{error?'Refresh failed; previous inventory may be stale. ':''}Source: {when(document.source_generated_at)} · {document.freshness} · projection: {document.generated_at}</p>
  <details><summary>Provenance</summary><p>Policy revision {document.policy_revision}. Source build {document.source_revision??'unverified'}. Declared work, runtime observations and deployment qualification are shown separately. Missing observations remain unknown.</p></details>
  <h3>PROJECT LANDSCAPE</h3><ProjectAreas projects={document.projects.filter(p=>monitored(p))}/>
  {document.projects.some(p=>!monitored(p))&&<details className="ops-inventory__not-monitored"><summary>Not monitored ({document.projects.filter(p=>!monitored(p)).length})</summary><ProjectAreas projects={document.projects.filter(p=>!monitored(p))}/></details>}
  <h3>HOSTS</h3><div className="ops-inventory__table"><table><caption>Approved Code Black hosts</caption><thead><tr><th>Host</th><th>State / contact</th><th>Collector</th><th>Capacity</th></tr></thead><tbody>{document.hosts.map(h=><tr key={h.id}><th scope="row">{h.name}</th><td>{h.state} · {h.freshness}<br/>{when(h.last_contact)}</td><td>{h.collector}</td><td>CPU {h.cpu_percent===null?'unknown':h.cpu_percent+'%'}<br/>Memory {h.memory_percent===null?'unknown':h.memory_percent+'%'}</td></tr>)}</tbody></table></div>
  <details><summary>SERVICES ({document.services.length} registered definitions; {document.services.filter(service=>service.source_present).length} source-reconciled)</summary><p>Registered definitions are not an active-service count. Matching source rows include project reconciliation; this is not an active-process count. Missing observations remain UNKNOWN. Service activity is not functional acceptance.</p><div className="ops-inventory__table"><table><thead><tr><th>Service / host</th><th>Observed state</th><th>Version / last success</th><th>Dependencies / lifecycle</th></tr></thead><tbody>{document.services.map(s=><tr key={s.key}><th scope="row">{s.name}<br/>{s.host}</th><td>{s.state}{!s.source_present?' — no source observation':''}</td><td>{s.version??'Unknown'}<br/>{when(s.last_success)}<br/>Observed: {when(s.observed_at??null)}</td><td>{s.dependencies.length?s.dependencies.join(', '):'No approved dependency evidence'}<br/>{s.lifecycle}</td></tr>)}</tbody></table></div></details>
  <h3>LINKS</h3><ul>{document.links.map(link=>{const href=link.approval==='APPROVED'?safeLink(link.url):null;return <li key={link.id}>{href?<a href={href} target="_blank" rel="noopener noreferrer">{link.name}</a>:<span>{link.name} — link awaiting audience approval</span>} · {link.verification} · {when(link.verified_at)}{link.lifecycle!=='RETAINED'?` · ${link.lifecycle}`:''}</li>})}</ul>
  <section className="ops-inventory__documents" aria-label="Code Black documents">
   <h3>DOCUMENTS</h3>
   <p>Local document metadata · {document.documents_state??'UNAVAILABLE'} · registry: {when(document.documents_generated_at??null)}. Paths identify files on the named host; file contents are not hosted here. File verification refers to the recorded time.</p>
   {!document.documents?.length?<p>No approved document metadata available.</p>:document.documents.map(item=><article key={item.id}>
    <h4>{item.name}</h4><dl><dt>Host / project</dt><dd>{item.host.toUpperCase()} / {item.project_id}</dd><dt>Local path</dt><dd><code>{item.local_path}</code></dd><dt>Version</dt><dd>{item.version}</dd><dt>Review owner</dt><dd>{item.owner}</dd><dt>Document status</dt><dd>{item.status.replaceAll('_',' ')}</dd><dt>File verified</dt><dd>{item.verified_at} · {item.verification}</dd><dt>SHA-256</dt><dd><code>{item.sha256}</code></dd></dl>
   </article>)}
  </section>
 </section>
}
