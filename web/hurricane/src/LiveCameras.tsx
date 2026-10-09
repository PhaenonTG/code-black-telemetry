import { useEffect, useMemo, useState } from "react";
import { selectCameras } from "./cameraSelection";
import type { CoastCamera } from "./cameraSelection";
import { activeWarnings } from "./nwsAlerts";
import type { NwsAlert } from "./nwsAlerts";
import type { PublicHurricane } from "./types";

function CameraCard({ camera, role, warning }: { camera: CoastCamera; role: string; warning: string | null }) {
  return <article className="live-camera-card"><div className="live-camera-card__top"><span>{role}</span><strong>{camera.name}</strong></div>
    <div className="live-camera-card__video"><iframe title={`${camera.name} live camera from ${camera.provider}`} src={camera.embed} allow="autoplay; fullscreen; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" loading="eager"/></div>
    <div className="live-camera-card__foot"><span>{warning ?? camera.outlook}</span><a href={camera.source} target="_blank" rel="noreferrer">{camera.provider} ↗</a></div></article>;
}

export default function LiveCameras({ data }: { data: PublicHurricane }) {
  const [alerts, setAlerts] = useState<NwsAlert[]>([]);
  const [alertsAvailable, setAlertsAvailable] = useState(true);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let mounted = true;
    const refresh = () => void activeWarnings().then(({ features }) => {
      if (mounted) { setAlerts(features); setAlertsAvailable(true); }
    }).catch(() => { if (mounted) setAlertsAvailable(false); });
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, []);
  const selected = useMemo(() => selectCameras(data, alerts), [data, alerts]);
  const cams = mobile ? selected.center ? [selected.center] : [] : selected.desktop;
  const labels = selected.desktop.map((camera, index) => camera.id === selected.center?.id && selected.warning ? "WARNING AREA" : ["WEST", "TRACK NEAR", "EAST"][index] ?? "COAST");
  return <section className="live-cameras" id="cameras" aria-label="Live coastal cameras"><div className="live-cameras__head"><div><span className="eyebrow">COASTAL OBSERVATIONS</span><h2>Live cameras</h2></div><div className="live-cameras__state"><span className="live-dot"/> Track-selected · muted live feeds</div></div>
    {selected.warning && <div className="live-cameras__warning">{selected.warning.event} nearby · nearest available camera {Math.round(selected.warning.distance)} mi from warning polygon</div>}
    {!alertsAvailable && <div className="live-cameras__warning">NWS warning check unavailable — camera switching may be delayed. <a href="https://www.weather.gov/" target="_blank" rel="noreferrer">Check NWS ↗</a></div>}
    {cams.length ? <div className="live-cameras__grid">{cams.map((camera, index) => <CameraCard key={camera.id} camera={camera} role={mobile ? selected.warning ? "WARNING AREA" : "TRACK NEAR" : labels[index]} warning={selected.warning?.camera.id === camera.id ? selected.warning.event : null}/>)}</div> : <p className="empty">A track-based camera selection is unavailable. <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">NHC forecast ↗</a></p>}
    <p className="live-cameras__note">Selected by proximity to the experimental Aegis track, not by AI video analysis. Views and provider streams may change or fail; cameras cannot confirm eyewall position, tornadoes, or local safety. Warning priority begins only after an estimated coastal passage.</p>
  </section>;
}
