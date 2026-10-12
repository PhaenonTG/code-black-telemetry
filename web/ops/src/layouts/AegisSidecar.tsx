import { useEffect, useState } from "react"
import { useDesk } from "../desk/DeskProvider"
import { Icon } from "../components/Icon"

const AEGIS_CONSOLE_URL = "https://phaenon3.tail1d0673.ts.net/ai/"
const SIDECAR_KEY = "codeblack.ops.aegis-sidecar.open"

function readable(value: string | null | undefined, fallback = "Unavailable") {
  return value ? value.replaceAll("_", " ") : fallback
}

function initialOpen() {
  try { return localStorage.getItem(SIDECAR_KEY) !== "closed" } catch { return true }
}

export function AegisSidecar() {
  const [open, setOpen] = useState(initialOpen)
  const { observation, errors, activeUnit, referenceLabel } = useDesk()
  const official = observation?.radar?.official_storm_objects
  const radarProducts = Object.entries(observation?.radar?.products ?? {})
    .filter(([, product]) => product?.available)
    .map(([name, product]) => `${name} ${product.freshness_state ?? ""}`.trim())

  useEffect(() => {
    try { localStorage.setItem(SIDECAR_KEY, open ? "open" : "closed") } catch { /* visual preference only */ }
  }, [open])

  return <aside className={`aegis-sidecar ${open ? "is-open" : "is-collapsed"}`} aria-label="Aegis evidence and chat">
    <button className="aegis-sidecar__toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Icon name={open ? "close" : "ops"} />
      <span>{open ? "Collapse Aegis" : "Aegis"}</span>
    </button>
    {open && <div className="aegis-sidecar__panel">
      <header className="aegis-sidecar__header">
        <div><span>AEGIS</span><h2>Evidence + chat</h2></div>
        <b data-state={errors.Observation ? "attention" : observation?.state ?? "loading"}>{errors.Observation ? "SOURCE CHECK" : readable(observation?.state, "LOADING")}</b>
      </header>

      <section className="aegis-sidecar__evidence" aria-label="Current Aegis evidence">
        <div><span>RADAR</span><strong>{errors.Observation ? "Source unavailable" : radarProducts.join(" · ") || "Awaiting evidence"}</strong></div>
        <div><span>OFFICIAL OBJECTS</span><strong>{official ? `${readable(official.state)} · ${official.object_count ?? 0} objects` : "Awaiting feed"}</strong></div>
        <div><span>SATELLITE</span><strong>{readable(observation?.satellite?.state)}{observation?.satellite?.satellite ? ` · ${observation.satellite.satellite}` : ""}</strong></div>
        <div><span>CHASE CONTEXT</span><strong>{activeUnit?.display_name ?? referenceLabel}</strong></div>
      </section>

      <section className="aegis-sidecar__conversation" aria-label="Aegis conversation">
        <div className="aegis-sidecar__conversation-head"><div><span>CONVERSATION</span><p>Discuss evidence, uncertainty, and next checks.</p></div><a href={AEGIS_CONSOLE_URL} target="_blank" rel="noreferrer">OPEN ↗</a></div>
        <iframe className="aegis-sidecar__frame" title="Aegis chat" src={AEGIS_CONSOLE_URL} />
        <p className="aegis-sidecar__hint">If the private console cannot load in this pane, use Open. It remains Tailnet-only.</p>
      </section>
    </div>}
  </aside>
}
