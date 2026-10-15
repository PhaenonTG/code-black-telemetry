import { useState } from "react"
import type { StatusAttention, StatusCenterDocument } from "./statusCenterClient"
import "./incident-desk.css"

function when(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : "No verified time"
}

function serviceFor(item: StatusAttention, document: StatusCenterDocument) {
  return item.id.startsWith("svc:") ? document.services?.find((service) => service.id === item.id.slice(4)) : undefined
}

export function IncidentDesk({ document, error }: { document: StatusCenterDocument | null; error: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const incidents = document?.attention ?? []
  const selected = incidents.find((item) => item.id === selectedId)
  const service = selected && document ? serviceFor(selected, document) : undefined

  async function copyBrief(item: StatusAttention) {
    const brief = ["Code Black incident investigation", `Title: ${item.title}`, `Core attention ID: ${item.id}`,
      `Source: ${item.source ?? "unknown"}`, `First observed: ${item.since ?? "unknown"}`,
      `Evidence: ${item.detail ?? "No detail in current Core report"}`,
      service ? `Service: ${service.name} · ${service.state} · ${service.state_reason ?? "no reason"}` : "",
      "In #infrastructure-alerts, run /luna repair and choose the matching Discord alert ID. Review the proposed command before approving a risky fix."].filter(Boolean).join("\n")
    try { await navigator.clipboard.writeText(brief); setCopied(true) }
    catch { setCopied(false) }
  }

  return <section className="status-center__panel incident-desk" aria-label="Attention queue">
    <h2>ATTENTION QUEUE</h2>
    {error ? <p className="status-center__muted">Current attention queue unavailable. Previously received items may be out of date.</p> : !document ? <p className="status-center__muted">Loading attention queue…</p> : incidents.length === 0 ? <p className="status-center__muted">No active operator attention items.</p> : <div className="status-center__attention incident-desk__list">
      {incidents.map((item) => <article key={item.id}>
        <span>{item.severity ?? "NOTICE"}</span><b>{item.title}</b><p>{item.detail ?? "No detail provided"}</p>
        <button type="button" onClick={() => { setSelectedId(item.id); setCopied(false) }}>OPEN INCIDENT ↗</button>
      </article>)}
    </div>}
    {selected && <div className="incident-desk__drawer" role="region" aria-label={`${selected.title} incident details`}>
      <div className="incident-desk__drawer-head"><span>INCIDENT DOSSIER // {selected.severity ?? "NOTICE"}</span><button type="button" onClick={() => setSelectedId(null)} aria-label="Close incident details">CLOSE ×</button></div>
      <h3>{selected.title}</h3><p>{selected.detail ?? "Core has no further description for this alert."}</p>
      <dl><div><dt>FIRST SEEN</dt><dd>{when(selected.since)}</dd></div><div><dt>SOURCE</dt><dd>{selected.source ?? "Unknown"}</dd></div>
        <div><dt>SERVICE</dt><dd>{service ? `${service.name} · ${service.state}` : "No direct service match"}</dd></div>
        <div><dt>LAST GOOD READING</dt><dd>{when(service?.last_success ?? service?.telemetry?.last_success)}</dd></div>
        <div><dt>ACKNOWLEDGED</dt><dd>{when(selected.operator?.acknowledged_at)}</dd></div><div><dt>SNOOZED UNTIL</dt><dd>{when(selected.operator?.snoozed_until)}</dd></div></dl>
      {service?.state_reason && <p className="incident-desk__evidence"><b>LIVE EVIDENCE</b>{service.state_reason}</p>}
      {service?.last_error && <p className="incident-desk__evidence"><b>LAST ERROR</b>{service.last_error}</p>}
      <div className="incident-desk__actions"><button type="button" onClick={() => { void copyBrief(selected) }}>{copied ? "BRIEF COPIED" : "COPY LUNA BRIEF"}</button>
        {selected.link && <a href={selected.link} target="_blank" rel="noreferrer">OPEN SOURCE ↗</a>}
        {!selected.status_only && <a href={`https://codeblack-core.tail1d0673.ts.net/alert-actions/incident?id=${encodeURIComponent(selected.id)}`} target="_blank" rel="noreferrer">OPEN ACTIONS ↗</a>}
        <a href="https://codeblack-core.tail1d0673.ts.net/status/" target="_blank" rel="noreferrer">OPEN CORE ↗</a></div>
      <small>Use /luna repair in Discord #infrastructure-alerts and select the matching alert. Safe fixes can run there; other exact commands require your approval. Core and Discord alert IDs may differ.</small>
    </div>}
  </section>
}
