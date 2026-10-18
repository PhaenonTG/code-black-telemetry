import { useState } from "react"
import ConfirmDialog from "../components/ConfirmDialog"
import { outputStartReason, type ObsOutputStatus, type OutputTarget } from "./obsOutputPolicy"
const DESTINATIONS = { facebook: "Storm Chaser Nick Mounce", youtube: "Code Black WX" } as const
type Props = {
  status?: ObsOutputStatus; owner: boolean; allowed: boolean; online: boolean; busy: boolean;
  onCommand: (action: string, confirmed?: boolean, expectedComposition?: string) => Promise<void>;
}
export default function ObsOutputControls(props: Props) {
  // A connection/permission/lease transition invalidates any checked dialog.
  return <DestinationControls key={`${props.owner}:${props.allowed}:${props.online}`} {...props} />
}
function DestinationControls({ status, owner, allowed, online, busy, onCommand }: Props) {
  const [confirmation, setConfirmation] = useState<{ target: OutputTarget; operation: "start" | "stop"; compositionId?: string; identity: string } | null>(null)
  const [verified, setVerified] = useState(false)
  const identity = JSON.stringify([status?.engine, status?.composition?.id, status?.outputs?.facebook?.destination, status?.outputs?.youtube?.destination])
  if (confirmation && confirmation.identity !== identity) { setConfirmation(null); setVerified(false) }
  const unknown = status?.outputs?.facebook?.state === "UNKNOWN" || status?.outputs?.youtube?.state === "UNKNOWN"
  return <section aria-label="Facebook and YouTube OBS outputs">
    <h3>Stream destinations · OBS PROGRAM</h3>
    <p className="workspace-note">Both use the same camera, Fieldline overlay, and PROGRAM audio. Starting an encoder can publish immediately; it is not a private preview.</p>
    {unknown && <p role="alert">An output state is unknown. Check OBS before attempting another start.</p>}
    <div className="producer-controls__grid">{(["facebook", "youtube"] as const).map(target => {
      const output = status?.outputs?.[target]
      const state = online ? output?.state ?? "UNKNOWN" : "UNKNOWN"
      const reason = outputStartReason(status, target, owner)
      const stopSupported = status?.capabilities?.actions?.outputs?.includes(`${target}.stop`) === true
      return <section key={target} aria-label={`${target} output`}>
        <h4>{target === "facebook" ? "Facebook" : "YouTube"} · {DESTINATIONS[target]}</h4>
        <p role="status">Encoder: <strong>{state}</strong></p>
        {reason && <p className="workspace-note">{reason}</p>}
        <button type="button" disabled={!allowed || !online || busy || Boolean(reason) || state !== "OFF" || unknown} onClick={() => { setVerified(false); setConfirmation({target, operation:"start",identity,compositionId:status?.composition?.id}) }}>Start {target === "facebook" ? "Facebook" : "YouTube"}…</button>
        <button type="button" disabled={!allowed || !online || busy || !stopSupported || state === "OFF"} onClick={() => { setVerified(false); setConfirmation({target, operation:"stop",identity}) }}>Stop {target === "facebook" ? "Facebook" : "YouTube"}…</button>
      </section>
    })}</div>
    {confirmation && confirmation.identity === identity && <ConfirmDialog title={`Confirm ${confirmation.target} ${confirmation.operation}`} onCancel={() => { setConfirmation(null); setVerified(false) }}
      consequence={confirmation.operation === "start" ? `Send PROGRAM to ${DESTINATIONS[confirmation.target]} on ${confirmation.target} now? This may immediately become public.` : `Stop sending PROGRAM to ${DESTINATIONS[confirmation.target]} on ${confirmation.target}? This interrupts that destination; stopping the encoder does not necessarily end its platform broadcast.`}>
      {confirmation.operation === "start" && <label><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} />I verified the destination, moving camera, Fieldline overlay, and audible PROGRAM audio.</label>}
      <button type="button" disabled={busy || !allowed || !online || (confirmation.operation === "start" && (!verified || confirmation.compositionId !== status?.composition?.id || Boolean(outputStartReason(status, confirmation.target, owner))))} onClick={() => { if (confirmation.identity !== identity) return; const action = `obs.output.${confirmation.target}.${confirmation.operation}`; setConfirmation(null); setVerified(false); void onCommand(action, true, confirmation.operation === "start" ? confirmation.compositionId : undefined) }}>Confirm {confirmation.operation} {confirmation.target}</button>
    </ConfirmDialog>}
  </section>
}
