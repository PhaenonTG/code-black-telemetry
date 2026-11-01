import { useState } from "react"
import type { OverlaySettings } from "./broadcasterStatus"

function copy(value: OverlaySettings): OverlaySettings { return { bug: { ...value.bug }, live: { enabled: value.live.enabled }, sourceName: { ...value.sourceName }, lowerThird: { ...value.lowerThird }, callsign: value.callsign, vehicle: value.vehicle } }
export default function ProducerOverlayEditor({ applied, enabled, sending, onApply, onHide }: { applied?: OverlaySettings; enabled: boolean; sending: boolean; onApply: (value: Record<string, unknown>) => void; onHide: () => void }) {
  const [draft, setDraft] = useState<OverlaySettings | null>(null)
  const [confirm, setConfirm] = useState(false)
  const value = draft ?? (applied ? copy(applied) : null)
  const dirty = Boolean(draft && applied && JSON.stringify(draft) !== JSON.stringify(copy(applied)))
  if (!value) return <p className="workspace-note">Overlay controls await current broadcaster settings.</p>
  const change = (next: Partial<OverlaySettings>) => { setDraft({ ...value, ...next }); setConfirm(false) }
  const apply = () => { onApply(copy(value)); setConfirm(false) }
  return <details className="producer-overlay-editor" open>
    <summary>PROGRAM overlays <span>{dirty ? "UNSAVED" : "APPLIED SETTINGS"}</span></summary>
    <fieldset disabled={!enabled}><legend className="sr-only">Composition settings</legend>
      <label className="producer-overlay-toggle"><input type="checkbox" checked={value.bug.enabled} onChange={e => change({ bug: { ...value.bug, enabled: e.target.checked } })} />Brand bug</label>
      <label>Brand text<input maxLength={24} value={value.bug.text} onChange={e => change({ bug: { ...value.bug, text: e.target.value } })} /></label>
      <label className="producer-overlay-toggle"><input type="checkbox" checked={value.live.enabled} onChange={e => change({ live: { enabled: e.target.checked } })} />LIVE badge · source-live only</label>
      <label className="producer-overlay-toggle"><input type="checkbox" checked={value.sourceName.enabled} onChange={e => change({ sourceName: { enabled: e.target.checked } })} />Source identity</label>
      <div className="producer-controls__grid"><label>Callsign<input maxLength={24} value={value.callsign} onChange={e => change({ callsign: e.target.value })} /></label><label>Vehicle<input maxLength={24} value={value.vehicle} onChange={e => change({ vehicle: e.target.value })} /></label></div>
      <label className="producer-overlay-toggle"><input type="checkbox" checked={value.lowerThird.enabled} onChange={e => change({ lowerThird: { ...value.lowerThird, enabled: e.target.checked } })} />Show lower third</label>
      <label>Lower third text<textarea maxLength={120} rows={2} value={value.lowerThird.text} onChange={e => change({ lowerThird: { ...value.lowerThird, text: e.target.value } })} /></label>
      <div className="producer-controls__grid"><button type="button" disabled={!dirty || !value.callsign.trim() || !value.vehicle.trim()} onClick={() => sending ? setConfirm(true) : apply()}>Apply overlays</button><button type="button" onClick={() => { setDraft(null); setConfirm(false) }}>Reload applied</button></div>
      <button type="button" onClick={onHide}>Hide lower third</button>
    </fieldset>
    {!enabled && <p className="workspace-note">Take control on an updated, online broadcaster to edit overlays.</p>}
    {confirm && <div role="alertdialog" aria-label="Confirm on-air overlay update"><p>Applying overlays briefly reconnects the Facebook encoder. Apply these changes now?</p><button type="button" disabled={!enabled} onClick={apply}>Confirm overlay update</button><button type="button" onClick={() => setConfirm(false)}>Cancel</button></div>}
    <p className="workspace-note">The monitor is composed at the output canvas size, then downscaled. Confirm the acknowledged composition in moving PROGRAM before publishing.</p>
  </details>
}
