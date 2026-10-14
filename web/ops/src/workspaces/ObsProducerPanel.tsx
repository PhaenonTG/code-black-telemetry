import { useState } from "react"
import { OBS_SCENES, obsResolution, supportsObsAction, type ObsStatus } from "./obsProducerPolicy"
import "./obsProducer.css"

type Props = { status?: ObsStatus; online: boolean; allowed: boolean; owner: boolean; busy: boolean; uncertain?: boolean; message: string; onLease: () => void; onResolveUncertainty?: () => void; onCommand: (action: string, payload?: Record<string, unknown>) => void }
export default function ObsProducerPanel({ status, online, allowed, owner, busy, uncertain = false, message, onLease, onResolveUncertainty, onCommand }: Props) {
  const [scene, setScene] = useState<string>(OBS_SCENES[0])
  const [volume, setVolume] = useState<number | null>(null)
  const ready = online && allowed && owner && !busy && !uncertain
  const can = (action: string) => ready && supportsObsAction(status, action)
  const stop = (action: string) => online && allowed && !busy && supportsObsAction(status, action)
  const inputVolume = typeof status?.audio?.inputVolumeDb === "number" && Number.isFinite(status.audio.inputVolumeDb) ? status.audio.inputVolumeDb : null
  const effectiveVolume = volume ?? inputVolume
  return <section className="workspace-panel producer-controls obs-producer" aria-label="OBS PROGRAM controls">
    <header><h2>OBS producer console</h2><span className={online ? "workspace-live" : "workspace-muted"}>{online ? "OBS CONNECTED" : "OBS OFFLINE"}</span></header>
    <p className="workspace-note">OBS on PHAENON3 runs the stream. This console sends authenticated, acknowledged commands; it does not replace OBS’s encoder.</p>
    <div className="obs-producer__telemetry">
      <div><span>PROGRAM output</span><strong>{obsResolution(status)}</strong><small>OBS configuration—not proof of Facebook ingest</small></div>
      <div><span>Current scene</span><strong>{status?.obs?.currentScene ?? "Not reported"}</strong></div>
      <div><span>Recording</span><strong>{status?.recording?.writeToDisk ? "PROGRAM RECORDING" : "NOT RECORDING"}</strong><small>Includes Fieldline; not a clean camera archive</small></div>
      <div><span>Facebook encoder</span><strong>{status?.broadcast?.state ?? "UNKNOWN"}</strong><small>Public Page status is separate</small></div>
    </div>
    <p className="workspace-warning">ESP → Core: unavailable. No onboard sensor readings are verified.</p>
    {status?.source_state !== "SOURCE_LIVE" && <p className="workspace-warning">Camera/audio freshness is not yet qualified. A connected OBS console does not prove a live camera feed.</p>}
    <p>{owner ? "You hold control; the lease renews while this tab is visible." : "Take control before switching scenes or changing audio."}</p>
    <button type="button" disabled={!allowed || busy || (!owner && !online)} onClick={onLease}>{owner ? "Release control" : "Take control"}</button>
    {!allowed && <p className="workspace-note">Only approved producer accounts can control OBS.</p>}
    <fieldset disabled={!can("obs.scene.set")}><legend>PROGRAM scene</legend>
      <label>Scene<select value={scene} onChange={event => setScene(event.target.value)}>{OBS_SCENES.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <button type="button" disabled={!can("obs.scene.set") || scene === status?.obs?.currentScene} onClick={() => onCommand("obs.scene.set", { sceneName: scene })}>Switch PROGRAM scene</button>
    </fieldset>
    <div className="producer-controls__grid">
      <button type="button" disabled={!can("preview.start")} onClick={() => onCommand("preview.start")}>Enable private monitor</button>
      <button type="button" disabled={!stop("preview.stop")} onClick={() => onCommand("preview.stop")}>Stop private monitor only</button>
      <button type="button" disabled={!can("obs.overlay.visibility") || status?.obs?.fieldlineVisible === undefined} onClick={() => onCommand("obs.overlay.visibility", { enabled: !status?.obs?.fieldlineVisible })}>{status?.obs?.fieldlineVisible ? "Hide Fieldline overlay" : "Show Fieldline overlay"}</button>
      <button type="button" disabled={!can("obs.audio.set") || status?.audio?.inputMuted === undefined} onClick={() => onCommand("obs.audio.set", { muted: !status?.audio?.inputMuted })}>{status?.audio?.inputMuted ? "Unmute Chase audio" : "Mute Chase audio"}</button>
    </div>
    <fieldset disabled={!can("obs.audio.set")}><legend>Chase audio gain</legend>
      <label>Input gain (−60 to 0 dB)<input type="number" min={-60} max={0} step={1} value={effectiveVolume === null ? "" : Math.round(effectiveVolume)} onChange={event => setVolume(event.target.value === "" ? null : Number(event.target.value))} /></label>
      <button type="button" disabled={!can("obs.audio.set") || effectiveVolume === null || !Number.isFinite(effectiveVolume) || effectiveVolume < -60 || effectiveVolume > 0} onClick={() => onCommand("obs.audio.set", { volumeDb: effectiveVolume })}>Apply audio gain</button>
      <p className="workspace-note">Gain is not an audio meter. Real level/clipping telemetry is still unqualified.</p>
    </fieldset>
    <div className="producer-controls__grid">
      <button type="button" disabled={!can("obs.recording.start") || status?.recording?.writeToDisk !== false} onClick={() => onCommand("obs.recording.start", {})}>Start PROGRAM recording</button>
      <button type="button" disabled={!stop("obs.recording.stop") || status?.recording?.writeToDisk !== true} onClick={() => onCommand("obs.recording.stop", {})}>Stop PROGRAM recording</button>
      <button type="button" disabled>Facebook Go Live — locked pending qualification</button>
      <button type="button" className="obs-producer__stop" disabled={!stop("facebook.output.stop")} onClick={() => onCommand("facebook.output.stop")}>STOP Facebook encoder</button>
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {uncertain && <p role="alert" className="workspace-warning">A command outcome is unconfirmed. Verify OBS directly before another mutation; do not retry the uncertain command. Stop controls remain available.</p>}
    {uncertain && onResolveUncertainty && <button type="button" disabled={!online || !owner || !allowed || busy} onClick={onResolveUncertainty}>Verified in OBS — unlock edits</button>}
    <p className="workspace-note">No automatic publishing. HLS audio/video monitoring and 360 controls are not connected yet. Weather labels distinguish NWS observations from model guidance.</p>
  </section>
}
