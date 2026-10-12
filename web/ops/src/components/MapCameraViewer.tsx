import { useRef } from "react"
import type { TrafficCamera } from "../../../../src/services/mapLayerModels"
import { CameraFeed } from "../desk/CameraFeed"
import { ageLabel } from "../desk/format"
import { useDialogFocus } from "./useDialogFocus"

export function MapCameraViewer({ camera, onClose, pinned = false, onTogglePin, lowBandwidth = false, onLowBandwidthChange, expanded = false }: {
  camera: TrafficCamera; onClose: () => void; pinned?: boolean; onTogglePin?: () => void;
  lowBandwidth?: boolean; onLowBandwidthChange?: (enabled: boolean) => void;
  expanded?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null)
  useDialogFocus(dialog, onClose)
  return <div className={`map-camera-viewer__backdrop${expanded ? " map-camera-viewer__backdrop--expanded" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside ref={dialog} tabIndex={-1} className="map-camera-viewer" role="dialog" aria-modal="true" aria-label={`${camera.name} camera`}>
      <header className="map-camera-viewer__header"><div><p>PUBLIC CAMERA</p><h2>{camera.name}</h2></div><div className="map-camera-viewer__actions">{onTogglePin && <button type="button" onClick={onTogglePin}>{pinned ? "UNPIN" : "PIN"}</button>}<button type="button" className="map-camera-viewer__close" onClick={onClose} aria-label="Close camera viewer">×</button></div></header>
      <div className="map-camera-viewer__media"><CameraFeed key={`${camera.id}-${lowBandwidth}`} camera={camera} snapshot={lowBandwidth} /></div>
      <div className="map-camera-viewer__meta"><div><span>ROAD</span><b>{camera.roadway ?? "Not reported"}</b></div><div><span>VIEW</span><b>{camera.direction ?? "Not reported"}</b></div><div><span>STATUS</span><b>{camera.availability.toUpperCase()}</b></div><div><span>AGE</span><b>{ageLabel(camera.lastUpdateAt)}</b></div></div>
      <footer className="map-camera-viewer__footer"><label className="map-camera-viewer__bandwidth"><input type="checkbox" checked={lowBandwidth} onChange={(event) => onLowBandwidthChange?.(event.target.checked)} />SNAPSHOT MODE</label><span>{camera.provider.displayLabel} · {camera.attribution}</span>{camera.sourceUrl && <a href={camera.sourceUrl} target="_blank" rel="noopener noreferrer">PROVIDER</a>}</footer>
    </aside>
  </div>
}
