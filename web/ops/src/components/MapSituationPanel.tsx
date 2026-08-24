import type { AlertProduct } from "../../../../src/services/situational"
import type { RoadConditionEvent } from "../../../../src/services/mapLayerModels"

type Selection = { kind: "alert"; alert: AlertProduct } | { kind: "road"; road: RoadConditionEvent }

function timeText(value: string | number | null) {
  if (!value) return "Not reported"
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "Not reported"
}

export function MapSituationPanel({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  if (selection.kind === "alert") {
    const a = selection.alert
    return <aside className="map-situation-panel" role="dialog" aria-modal="false" aria-label={a.title}>
      <header><div><p>WEATHER ALERT</p><h2>{a.title}</h2></div><button onClick={onClose} aria-label="Close details">×</button></header>
      <div className="map-situation-panel__body">
        <strong>{a.headline}</strong>
        <dl><div><dt>AREA</dt><dd>{a.area || "Not reported"}</dd></div><div><dt>EXPIRES</dt><dd>{timeText(a.expires)}</dd></div><div><dt>SOURCE</dt><dd>{a.source || "NWS"}</dd></div></dl>
        {a.description && <section><h3>DETAILS</h3><p>{a.description}</p></section>}
        {a.instruction && <section><h3>INSTRUCTIONS</h3><p>{a.instruction}</p></section>}
      </div>
      {a.url && <footer><a href={a.url} target="_blank" rel="noopener noreferrer">SOURCE</a></footer>}
    </aside>
  }
  const r = selection.road
  return <aside className="map-situation-panel" role="dialog" aria-modal="false" aria-label={r.title}>
    <header><div><p>ROAD CONDITION</p><h2>{r.title}</h2></div><button onClick={onClose} aria-label="Close details">×</button></header>
    <div className="map-situation-panel__body">
      <strong>{r.status || r.closureState}</strong>
      <dl>
        <div><dt>ROAD</dt><dd>{r.roadway ?? "Not reported"}</dd></div><div><dt>DIRECTION</dt><dd>{r.direction}</dd></div>
        <div><dt>SEVERITY</dt><dd>{r.severity.toUpperCase()}</dd></div><div><dt>FRESHNESS</dt><dd>{r.freshness.toUpperCase()}</dd></div>
        <div><dt>UPDATED</dt><dd>{timeText(r.updatedAt)}</dd></div><div><dt>PROVIDER</dt><dd>{r.provider.displayLabel}</dd></div>
      </dl>
      {r.description && <section><h3>DETAILS</h3><p>{r.description}</p></section>}
    </div>
    {r.sourceUrl && <footer><a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">PROVIDER</a></footer>}
  </aside>
}
