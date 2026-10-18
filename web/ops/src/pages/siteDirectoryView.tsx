import {useMemo,useState} from 'react'
export interface DirectoryEntry{id:string;name:string;url:string|null;openable:boolean;host:string;purpose:string;group:string;access:string;checked_at:string|null;http_status:number|null;verification:string;lifecycle:string;note:string}
export interface DirectoryDocument{schema:'codeblack.directory.v1';generated_at:string;source_revision:string;update_mode:string;update_note:string;feed_state?:string;entries:DirectoryEntry[]}
export function filterDirectoryEntries(entries:DirectoryEntry[],search:string,group:string){return entries.filter(e=>(!group||e.group===group)&&[e.name,e.url,e.host,e.purpose,e.access,e.group].join(' ').toLowerCase().includes(search.toLowerCase()))}
export function DirectoryContent({document,error,onRefresh}:{document:DirectoryDocument|null;error:string|null;onRefresh:()=>void}){
 const [search,setSearch]=useState(''),[group,setGroup]=useState('')
 const groups=useMemo(()=>[...new Set(document?.entries.map(e=>e.group)??[])].sort(),[document])
 const entries=useMemo(()=>filterDirectoryEntries(document?.entries??[],search,group),[document,search,group])
 return <section className="site-directory" aria-label="Code Black site directory">
  <header><img src="/directory-assets/shield.png" alt="Code Black shield"/><div><h1>SITE DIRECTORY</h1><p>Code Black destinations, access requirements and verification dates.</p></div><button type="button" onClick={onRefresh}>Refresh directory</button><button type="button" onClick={()=>{(window as Window&{replaySplash?:()=>void}).replaySplash?.()}}>Replay app splash</button></header>
  {error&&<p role="alert">{error}</p>}
  {!document?<p role="status">{error?'Directory data unavailable.':'Loading authorized directory.'}</p>:<>
   <p className="site-directory__notice">Registry snapshot: {document.generated_at} · {document.feed_state??'PUBLISHED_SNAPSHOT'}. {document.update_note} Destination sign-in and private-network access still apply.</p>
   <div className="site-directory__filters"><label>Search sites <input type="search" value={search} onChange={e=>setSearch(e.target.value)} /></label><label>Group <select value={group} onChange={e=>setGroup(e.target.value)}><option value="">All groups</option>{groups.map(g=><option key={g} value={g}>{g}</option>)}</select></label><span role="status">{entries.length} of {document.entries.length} links</span></div>
   {!entries.length&&<p>No destinations match these filters.</p>}
   <div className="site-directory__grid">{entries.map(entry=><article key={entry.id}><p>{entry.group} · {entry.host}</p><h2>{entry.name}</h2><p>{entry.purpose}</p><p>{entry.access}</p><p>{entry.checked_at?`${entry.checked_at} · HTTP ${entry.http_status??'not recorded'} · observation only`:'Not live-checked'}</p>{entry.url&&entry.openable?<a href={entry.url} target="_blank" rel="noopener noreferrer">Open destination ↗</a>:<span>Host-local or unresolved link; use the exact address only on its named host</span>}<details><summary>Exact address and evidence</summary><p>{entry.url??'Withheld'}<br/>{entry.note}<br/>Lifecycle: {entry.lifecycle}</p></details></article>)}</div>
   <details><summary>Snapshot provenance</summary><p>Source revision {document.source_revision}. Browser refresh reads this protected published snapshot. No destination probe runs here.</p></details>
  </>}
 </section>
}
