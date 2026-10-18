import {useMemo,useState} from 'react'
export interface DirectoryEntry{id:string;name:string;url:string|null;openable:boolean;host:string;purpose:string;group:string;access:string;checked_at:string|null;http_status:number|null;verification:string;lifecycle:string;note:string}
export interface DirectoryDocument{schema:'codeblack.directory.v1';generated_at:string;source_revision:string;update_mode:string;update_note:string;feed_state?:string;entries:DirectoryEntry[]}
export function filterDirectoryEntries(entries:DirectoryEntry[],search:string,group:string){return entries.filter(e=>(!group||e.group===group)&&[e.name,e.url,e.host,e.purpose,e.access,e.group].join(' ').toLowerCase().includes(search.toLowerCase()))}

// ---- Presentation-only grouping and openability, derived from the published snapshot ----
// No URL, data or role policy changes: every entry and its exact address remain visible; obvious
// duplicates are only drawn as one card with variants.

/** The snapshot's own last observation recorded a client/server error (e.g. HTTP 404). */
function lastCheckFailed(entry:DirectoryEntry){return typeof entry.http_status==='number'&&entry.http_status>=400}
/** Offer "Open destination" only when the snapshot marks it openable and its last check did not fail. */
function isEntryOpenable(entry:DirectoryEntry){return !!entry.url&&entry.openable&&!lastCheckFailed(entry)}

// Same destination ignoring scheme, a leading "www." and the trailing slash / #section fragment.
function destinationKey(url:string|null){
 if(!url)return null
 try{const u=new URL(url);return `${u.hostname.toLowerCase().replace(/^www\./,'')}${u.port?':'+u.port:''}${u.pathname.replace(/\/+$/,'')||'/'}`}catch{return null}
}
const VARIANT_SUFFIX=/\s*(?:[-–—·(]\s*)?\b(lan|tailscale|tailnet|www)\b\)?\s*$/i
// "Pi-hole (Edge) - LAN" and "Pi-hole (Edge) - Tailscale" share the base name "pi-hole (edge)".
function variantBaseName(name:string){const base=name.replace(VARIANT_SUFFIX,'').trim();return base&&base!==name.trim()?base.toLowerCase():null}
function variantLabel(entry:DirectoryEntry,primary:DirectoryEntry){
 const suffix=entry.name.match(VARIANT_SUFFIX)?.[1]
 if(suffix)return suffix.toLowerCase()==='lan'?'LAN':suffix.toLowerCase()==='www'?'www':suffix[0].toUpperCase()+suffix.slice(1).toLowerCase()
 if(entry.url){try{const u=new URL(entry.url);if(u.hash&&entry.name!==primary.name)return entry.name;if(u.hostname.startsWith('www.'))return 'www'}catch{/* fall through */}}
 return entry.name
}
interface DirectoryGroup{key:string;primary:DirectoryEntry;variants:DirectoryEntry[]}
/** Card title: a LAN/Tailscale-suffixed primary is titled by its shared base name. */
function groupTitle({primary,variants}:DirectoryGroup){const base=primary.name.replace(VARIANT_SUFFIX,'').trim();return variants.length&&base&&base!==primary.name.trim()?base:primary.name}
function primaryRank(e:DirectoryEntry){let rank=0;if(isEntryOpenable(e))rank-=4;if(e.url&&!/#|\/\/www\./.test(e.url))rank-=2;if(typeof e.http_status==='number'&&e.http_status<300)rank-=1;return rank}
function groupDirectoryEntries(entries:DirectoryEntry[]):DirectoryGroup[]{
 const parent=entries.map((_,i)=>i),find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i])),join=(a:number,b:number)=>{const x=find(a),y=find(b);if(x!==y)parent[Math.max(x,y)]=Math.min(x,y)}
 const byKey=new Map<string,number>()
 entries.forEach((e,i)=>{
  const keys=[destinationKey(e.url)&&'url:'+destinationKey(e.url)]
  const base=variantBaseName(e.name);if(base)keys.push(`name:${e.group}:${base}`)
  for(const k of keys){if(!k)continue;const seen=byKey.get(k);if(seen===undefined)byKey.set(k,i);else join(seen,i)}
 })
 // A bare name is its own base for name-variant matching (e.g. "Code Black WX" + "Code Black WX www").
 entries.forEach((e,i)=>{const seen=byKey.get(`name:${e.group}:${e.name.trim().toLowerCase()}`);if(seen!==undefined)join(seen,i)})
 const groups=new Map<number,DirectoryEntry[]>()
 entries.forEach((e,i)=>{const root=find(i);groups.set(root,[...(groups.get(root)??[]),e])})
 return [...groups.values()].map(members=>{const sorted=members.length>1?[...members].sort((a,b)=>primaryRank(a)-primaryRank(b)):members;return{key:sorted[0].id,primary:sorted[0],variants:sorted.slice(1)}})
}

function CheckLine({entry}:{entry:DirectoryEntry}){
 return <p className={lastCheckFailed(entry)?'site-directory__check site-directory__check--failed':'site-directory__check'}>{entry.checked_at?`${entry.checked_at} · HTTP ${entry.http_status??'not recorded'} · observation only`:'Not live-checked'}</p>
}
function OpenAction({entry,label='Open destination ↗'}:{entry:DirectoryEntry;label?:string}){
 if(isEntryOpenable(entry))return <a className="site-directory__open" href={entry.url!} target="_blank" rel="noopener noreferrer">{label}</a>
 if(entry.url&&entry.openable&&lastCheckFailed(entry))return <span className="site-directory__unavailable">Last check returned HTTP {entry.http_status}; link not offered. Exact address remains in the evidence below.</span>
 return <span className="site-directory__unavailable">Host-local or unresolved link; use the exact address only on its named host</span>
}

export function DirectoryContent({document,error,onRefresh}:{document:DirectoryDocument|null;error:string|null;onRefresh:()=>void}){
 const [search,setSearch]=useState(''),[group,setGroup]=useState('')
 const groups=useMemo(()=>[...new Set(document?.entries.map(e=>e.group)??[])].sort(),[document])
 const entries=useMemo(()=>filterDirectoryEntries(document?.entries??[],search,group),[document,search,group])
 const cards=useMemo(()=>groupDirectoryEntries(entries),[entries])
 return <section className="site-directory" aria-label="Code Black site directory">
  <header><img src="/directory-assets/shield.png" alt="Code Black shield"/><div><h1>SITE DIRECTORY</h1><p>Code Black destinations, access requirements and verification dates.</p></div><div className="site-directory__actions"><button type="button" onClick={onRefresh}>Refresh directory</button><button type="button" onClick={()=>{(window as Window&{replaySplash?:()=>void}).replaySplash?.()}}>Replay app splash</button></div></header>
  {error&&<p className="site-directory__error" role="alert">{error}</p>}
  {!document?<p className="site-directory__status" role="status">{error?'Directory data unavailable.':'Loading authorized directory.'}</p>:<>
   <p className="site-directory__notice">Registry snapshot: {document.generated_at} · {document.feed_state??'PUBLISHED_SNAPSHOT'}. {document.update_note} Destination sign-in and private-network access still apply.</p>
   <div className="site-directory__filters"><label>Search sites <input type="search" value={search} onChange={e=>setSearch(e.target.value)} /></label><label>Group <select value={group} onChange={e=>setGroup(e.target.value)}><option value="">All groups</option>{groups.map(g=><option key={g} value={g}>{g}</option>)}</select></label><span role="status">{entries.length} of {document.entries.length} links{cards.length!==entries.length?` · ${cards.length} cards (duplicates grouped)`:''}</span></div>
   {!entries.length&&<p className="site-directory__status">No destinations match these filters.</p>}
   <div className="site-directory__grid">{cards.map(card=>{const {key,primary:entry,variants}=card,title=groupTitle(card);return <article key={key} className={lastCheckFailed(entry)?'site-directory__card site-directory__card--failed':'site-directory__card'}>
    <p className="site-directory__meta">{entry.group} · {entry.host}</p><h2>{title}</h2>{title!==entry.name&&<p className="site-directory__primary">Primary address: {variantLabel(entry,entry)}</p>}<p>{entry.purpose}</p><p className="site-directory__access">{entry.access}</p><CheckLine entry={entry}/><OpenAction entry={entry}/>
    {variants.length>0&&<div className="site-directory__variants"><p className="site-directory__variants-title">{variants.length} more {variants.length===1?'variant':'variants'} of this destination</p><ul>{variants.map(v=><li key={v.id}><div><b>{variantLabel(v,entry)}</b><span>{v.name}{v.host!==entry.host?` · ${v.host}`:''}</span><CheckLine entry={v}/></div><OpenAction entry={v} label="Open ↗"/></li>)}</ul></div>}
    <details><summary>Exact address and evidence</summary>{[entry,...variants].map(v=><p key={v.id}>{variants.length>0&&<><b>{v.name}</b><br/></>}{v.url??'Withheld'}<br/>{v.note}<br/>Lifecycle: {v.lifecycle}</p>)}</details>
   </article>})}</div>
   <details><summary>Snapshot provenance</summary><p>Source revision {document.source_revision}. Browser refresh reads this protected published snapshot. No destination probe runs here. Cards group entries that share a destination or LAN/Tailscale variant names; every published entry is still listed.</p></details>
  </>}
 </section>
}
