import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectCameras } from "./cameraSelection";
import type { CoastCamera } from "./cameraSelection";
import { activeWarnings } from "./nwsAlerts";
import type { NwsAlert } from "./nwsAlerts";
import type { PublicHurricane } from "./types";

const uids: Record<string, string> = {
  waveland: "4f70bbceee1ebd135dfd11cd9eff155f",
  "bay-st-louis": "2502b0cae86fd8131e9cd1b1ee660b55",
  "biloxi-west": "5055c4885991616ff771d9f57be64b1b",
  "gulf-shores": "5da7ce0cd284c9bc597bd3777dc4ac00",
};
const roleLabel = { near: "NEAREST VERIFIED", west: "WEST OF TRACK", east: "EAST OF TRACK" };

function CameraCard({ camera, onFailure }: { camera: CoastCamera; onFailure: (id: string, failed: boolean) => void }) {
  const host = useRef<HTMLElement>(null);
  const timeoutRef = useRef<number | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const src = `https://api.wetmet.net/widgets/stream/frame.php?uid=${uids[camera.id]}&autoplay=1&muted=1&refresh=${retry}`;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "150px" });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { onFailure(camera.id, failed); }, [camera.id, failed, onFailure]);
  useEffect(() => {
    if (!visible) return;
    setLoaded(false);
    setFailed(false);
    // An iframe load only means the player arrived, not that video is advancing.
    // A stalled provider player retains its own controls and an external source link.
    timeoutRef.current = window.setTimeout(() => setFailed(true), 30_000);
    return () => window.clearTimeout(timeoutRef.current);
  }, [retry, visible]);

  const retryNow = () => setRetry((value) => value + 1);
  return <article ref={host} className="live-camera-card">
    <div className="live-camera-card__top"><span>{camera.role ? roleLabel[camera.role] : "COASTAL CAMERA"}</span><strong>{camera.name}</strong></div>
    <div className="live-camera-card__video">
      {visible && <iframe key={src} src={src} title={`${camera.name} coastal camera`} allow="autoplay; fullscreen" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" onLoad={() => { window.clearTimeout(timeoutRef.current); setLoaded(true); }} />}
      {visible && !loaded && !failed && <div className="camera-playback-overlay">Connecting to provider video…</div>}
      {failed && <div className="camera-playback-overlay">Camera player unavailable<button type="button" onClick={retryNow}>Retry feed</button></div>}
    </div>
    <div className="live-camera-card__foot"><span>{camera.outlook}</span><a href={camera.source} target="_blank" rel="noreferrer">Source ↗</a><button type="button" aria-label={`Reload ${camera.name} camera`} onClick={retryNow}>↻</button></div>
  </article>;
}

export default function LiveCameras({ data }: { data: PublicHurricane }) {
  const [alerts, setAlerts] = useState<NwsAlert[]>([]);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const onFailure = useCallback((id: string, failed: boolean) => setFailedIds((current) => {
    if (failed === current.includes(id)) return current;
    return failed ? [...current, id] : current.filter((value) => value !== id);
  }), []);
  useEffect(() => { const media = window.matchMedia("(max-width: 700px)"); const update = () => setMobile(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  useEffect(() => { let mounted = true; const refresh = () => void activeWarnings().then(({ features }) => { if (mounted) setAlerts(features); }).catch(() => undefined); refresh(); const interval = window.setInterval(refresh, 60_000); return () => { mounted = false; window.clearInterval(interval); }; }, []);
  const selected = useMemo(() => selectCameras(data, alerts), [data, alerts]);
  const allCameras = selected.dynamic;
  const preferred = allCameras.find((camera) => !failedIds.includes(camera.id)) ?? allCameras[0] ?? null;
  const active = (chosenId ? allCameras.find((camera) => camera.id === chosenId && !failedIds.includes(camera.id)) : null) ?? preferred;
  const eastGap = selected.target && allCameras.length > 0 && allCameras.every((camera) => camera.longitude < selected.target!.longitude);
  return <section className="live-cameras" id="cameras" aria-label="Live coastal cameras"><div className="live-cameras__head"><div><span className="eyebrow">COASTAL OBSERVATIONS</span><h2>Live cameras</h2></div><span className="live-cameras__state">Provider live streams</span></div>
    {eastGap && <p className="camera-coverage-gap">No dependable video camera east of the projected crossing. Showing the nearest available coastal views.</p>}
    {mobile ? <>{allCameras.length > 1 && <div className="camera-tabs" role="tablist" aria-label="Choose live camera">{allCameras.map((camera) => <button key={camera.id} type="button" role="tab" aria-selected={active?.id === camera.id} className={active?.id === camera.id ? "is-active" : ""} onClick={() => setChosenId(camera.id)}>{camera.role ? `${roleLabel[camera.role]} · ` : ""}{camera.name}</button>)}</div>}{active ? <div className="live-cameras__mobile-card"><CameraCard key={active.id} camera={active} onFailure={onFailure} /></div> : <p className="empty">Live camera selection is unavailable.</p>}</> : <div className="live-cameras__grid">{allCameras.map((camera) => <CameraCard key={camera.id} camera={camera} onFailure={onFailure} />)}</div>}
    <div className="camera-provider-links"><span>Other provider cams</span><a href="https://www.visitpensacola.com/webcams/south-view-webcam/" target="_blank" rel="noreferrer">Pensacola ↗</a><a href="https://www.fox10tv.com/weather/cams/" target="_blank" rel="noreferrer">Mobile / Dauphin Island ↗</a><a href="https://perdidokeyog.com/live-cam/" target="_blank" rel="noreferrer">Perdido Key ↗</a></div>
  </section>;
}
