import { compositionAligned, formatResolution, type NativeStatus } from "./broadcasterStatus"

const db = (value?: number | null) => typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : "—"
export default function BroadcasterReadout({ status }: { status?: NativeStatus }) {
  const formats = status?.formats, audio = status?.audio
  const aligned = compositionAligned(status)
  return <section className="producer-readout" aria-label="Native broadcaster telemetry">
    <div className="producer-readout__title"><strong>Broadcast workstation</strong><span>{status?.composition?.source?.toUpperCase() ?? "NO SOURCE"}</span></div>
    <dl className="producer-readout__formats">
      <div><dt>Source · reported input</dt><dd>{formatResolution(formats?.source)}</dd></div>
      <div><dt>PROGRAM · output target</dt><dd>{formatResolution(formats?.program)}</dd></div>
      <div><dt>Private monitor target</dt><dd>{formatResolution(formats?.monitor)}</dd></div>
      <div><dt>Encoder target</dt><dd>{formats?.program?.codec ?? "Not reported"}{formats?.program?.bitrateKbps ? ` · ${formats.program.bitrateKbps} kbps` : ""}</dd></div>
    </dl>
    <p className="workspace-note">Output target is encoder configuration, not proof of Facebook ingest. Monitor resolution is deliberately lower; decoded size appears under the video.</p>
    <div className="producer-readout__audio"><span>Audio RMS <b>{db(audio?.rmsDb)}</b></span><meter aria-label="Audio RMS level" min={-60} max={0} low={-45} high={-1} optimum={-18} value={typeof audio?.rmsDb === "number" ? Math.max(-60, Math.min(0, audio.rmsDb)) : -60} /><small>L {db(audio?.leftPeakDb)} · R {db(audio?.rightPeakDb)}</small></div>
    <dl className="producer-readout__formats">
      <div><dt>Source transport</dt><dd>{status?.transport_state ?? "UNKNOWN"}</dd></div>
      <div><dt>Camera archive</dt><dd>{status?.cameraArchive?.state ?? "UNKNOWN"}</dd></div>
      <div><dt>Video age</dt><dd>{typeof status?.metrics?.video_age_ms === "number" ? `${(status.metrics.video_age_ms / 1000).toFixed(1)} s` : "Not reported"}</dd></div>
      <div><dt>Reconnects</dt><dd>{status?.metrics?.reconnect_count ?? "—"}</dd></div>
    </dl>
    <p className={aligned ? "workspace-live" : "workspace-warning"}>{aligned ? "Current composition is reaching the private monitor." : "Awaiting live video and a matching monitor composition."}</p>
    {status?.overlays && <p className="workspace-note">Applied: brand {status.overlays.bug.enabled ? "ON" : "OFF"} · LIVE badge {status.overlays.live.enabled ? "armed (source-live only)" : "OFF"} · name {status.overlays.sourceName.enabled ? "ON" : "OFF"} · lower third {status.overlays.lowerThird.enabled ? "ON" : "OFF"}</p>}
  </section>
}
