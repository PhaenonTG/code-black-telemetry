import { useEffect, useState, type ReactNode } from "react";
import { PhoneSheet } from "../components/PhoneSheet";
import { ageText, type RadarFrame, type RadarProduct, type RadarSite } from "../services/radar";
import type { MapLayerVisibility } from "../services/settings";
import { AtlasRadarLegend } from "./AtlasRadarLegend";

const LAYERS: Partial<Record<keyof MapLayerVisibility, string>> = {
  warnings: "Warnings", watches: "Watches", mesoscaleDiscussions: "Mesoscale discussions", specialStatements: "Special statements",
  team: "Team", chasers: "Spotters", poi: "Points of interest", roadConditions: "Road conditions", trafficCameras: "Traffic cameras",
  surfaceStations: "Surface observations", stormReports: "Storm reports", riverGauges: "River gauges", chaserNet: "Chaser Net", breadcrumbs: "Position trail",
};

export interface PhoneRadarChromeProps {
  product: RadarProduct; onProduct(product: RadarProduct): void;
  frame: RadarFrame | null; frameCount: number; frameIndex: number; onFrame(index: number): void;
  playing: boolean; onPlaying(value: boolean): void; loadError: boolean;
  sites: RadarSite[]; site: string; onSite(site: string): void;
  tilt: number; tilts: number[]; onTilt(tilt: number): void;
  visibility: MapLayerVisibility; onVisibility(value: MapLayerVisibility): void;
  onZoom(delta: number): void; onHeading(): void; heading: string;
  onZoomLock(): void; zoomLocked: boolean; onAhead(): void; ahead: boolean;
  hasTrail: boolean; onExportTrail(): void; onClearTrail(): void;
  diagnostics: string[]; tools?: ReactNode; motion(onClose: () => void): ReactNode;
}

export function PhoneRadarChrome(p: PhoneRadarChromeProps) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const single = p.visibility.radar;
  const age = p.frame ? Math.max(p.frame.ageSeconds, Math.floor((now - Date.parse(p.frame.time)) / 1000)) : 0;
  const freshness = p.frame ? (age >= 900 ? "STALE" : age >= 300 && p.frame.freshness === "LIVE" ? "DELAYED" : p.frame.freshness) : "OFFLINE";
  const canPlay = single && p.frameCount > 1;
  return <>
    <header className="ops-radar-header"><h1>Radar</h1><button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">Tools</button></header>
    <div className="ops-radar-products" aria-label="Radar product">
      {(["REF", "VEL", "SRV", "CC"] as const).map(product => <button type="button" key={product} aria-pressed={single && p.product === product} onClick={() => {
        p.onVisibility({ ...p.visibility, radar: true, mosaic: false });
        p.onProduct(product);
        if (product === "SRV") setOpen(true);
      }}>{product}</button>)}
    </div>
    <div className="ops-radar-transport" aria-label="Radar playback">
      <button type="button" disabled={!canPlay} aria-label={p.playing && canPlay ? "Pause radar" : "Play radar"} onClick={() => p.onPlaying(!p.playing)}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{p.playing && canPlay ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4v16l13-8z" />}</svg></button>
      <input type="range" aria-label="Radar frame" min={0} max={Math.max(0, p.frameCount - 1)} value={Math.min(p.frameIndex, Math.max(0, p.frameCount - 1))} disabled={!canPlay} onChange={event => { p.onPlaying(false); p.onFrame(Number(event.target.value)); }} />
      <div className="ops-radar-freshness" data-freshness={freshness}>
        <strong>{single ? `${p.frame?.site.id ?? (p.site || "Auto site")} · ${p.product}` : "Mosaic"}</strong>
        <span>{!single ? "Automatic mosaic loop" : p.frame ? `${freshness.toLowerCase()} · ${ageText(age)} old${p.loadError ? " · update failed" : ""}` : p.loadError ? "Unavailable · retrying" : "Loading frames…"}</span>
      </div>
    </div>
    <PhoneSheet open={open} title="Radar tools" onClose={() => setOpen(false)}>
      <label className="ops-radar-field">Radar source<select aria-label="Radar source" value={single ? "single" : "mosaic"} onChange={e => p.onVisibility({ ...p.visibility, radar: e.target.value === "single", mosaic: e.target.value === "mosaic" })}><option value="single">Single-site radar</option><option value="mosaic">Wide-area mosaic</option></select></label>
      {single && <>
        <label className="ops-radar-field">Site<select value={p.site} onChange={e => p.onSite(e.target.value)}><option value="">Automatic healthy site</option>{p.sites.map(site => <option key={site.id} value={site.id}>{site.id} · {site.name}</option>)}{p.site && !p.sites.some(site => site.id === p.site) && <option value={p.site}>{p.site}</option>}</select></label>
        <label className="ops-radar-field">Elevation cut<select value={p.tilt} onChange={e => p.onTilt(Number(e.target.value))}>{p.tilts.map(tilt => <option key={tilt} value={tilt}>Tilt {tilt}</option>)}</select></label>
        <AtlasRadarLegend product={p.product} />
        {p.product === "SRV" && <section aria-label="Storm motion">{p.motion(() => setOpen(false))}</section>}
      </>}
      <details><summary>Layers</summary><div className="ops-radar-layers">{Object.entries(LAYERS).map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={p.visibility[key as keyof MapLayerVisibility]} onChange={e => p.onVisibility({ ...p.visibility, [key]: e.target.checked })} /></label>)}</div></details>
      <details><summary>Map & trail</summary><div className="ops-radar-tool-grid">
        <button type="button" onClick={() => p.onZoom(1)}>Zoom in</button><button type="button" onClick={() => p.onZoom(-1)}>Zoom out</button>
        <button type="button" onClick={p.onHeading}>{p.heading}</button><button type="button" aria-pressed={p.zoomLocked} onClick={p.onZoomLock}>Zoom lock</button>
        <button type="button" aria-pressed={p.ahead} onClick={p.onAhead}>Route ahead</button>
        <button type="button" disabled={!p.hasTrail} onClick={p.onExportTrail}>Export trail</button><button type="button" disabled={!p.hasTrail} onClick={p.onClearTrail}>Clear trail</button>
      </div></details>
      {p.tools}
      <details><summary>Diagnostics</summary>{p.diagnostics.filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}{p.frame && <p>Source: {p.frame.sourceLevel} · Frame {p.frame.frameId}</p>}</details>
    </PhoneSheet>
  </>;
}
