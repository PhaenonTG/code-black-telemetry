import type { PcLauncher } from "./pcPreparation"
export function PcPreparationResult({doc}: {doc: PcLauncher | null}) {
 const result = doc?.last?.result
 if (!doc?.last) return null
 const at = doc.last.completedAt ?? doc.last.createdAt
 return <div className={doc.online ? "" : "pc-prepare__last-known"}>
  {!doc.online && <p>Last known ({at ? new Date(at).toLocaleString() : "date unavailable"}) - helper offline; current readiness unknown</p>}
  <p>{doc.online ? "Last" : "Last known"} {doc.last.action ?? "preparation"}: {doc.last.state.toUpperCase()}.</p>
  {result && <div className="pc-prepare__results" aria-label={doc.online ? "Last PC health check" : "Last known PC health check"}>
   <span>{doc.online ? "PC" : "Last known PC"}: <b>{result.pcReady ? doc.online ? "READY" : "Previously ready" : "NEEDS ATTENTION"}</b></span>
   <span>Camera/audio: <b>{result.feedReady ? doc.online ? "READY" : "Previously ready" : "WAITING"}</b></span>
   <span>Both outputs: <b>{result.outputsOff ? "OFF" : "VERIFY IN OBS"}</b></span>
   <span>YouTube key: <b>{result.youtubeConfigured ? "CONFIGURED" : "PENDING"}</b></span>
  </div>}
 </div>
}
