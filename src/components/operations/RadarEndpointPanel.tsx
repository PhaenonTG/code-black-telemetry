import { useEffect, useState } from "react";
import { readAtlasDiagnostics } from "../../map/AtlasDiagnostics";
import type { AtlasDiagnosticsSnapshot } from "../../map/types";
import { readMapRuntimeDiagnostics, type MapRuntimeDiagnostics } from "../../services/mapTiles";
import { clearRadarCache, getRadarCacheStatus, getRadarStatus, setRadarStormMotion, type RadarStatus } from "../../services/radar";
import { readRadarLoopDiagnostics, type RadarLoopDiagnostics } from "../../services/radarLoop";

type CacheStatus = {
  usedBytes: number;
  limitBytes: number;
  sites: number;
  frames: number;
  oldestFrame: string | null;
  newestFrame: string | null;
};

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function RadarEnginePanel() {
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [cache, setCache] = useState<CacheStatus | null>(null);
  const [mapDiagnostics, setMapDiagnostics] = useState<MapRuntimeDiagnostics | null>(null);
  const [atlasDiagnostics, setAtlasDiagnostics] = useState<AtlasDiagnosticsSnapshot | null>(null);
  const [loopDiagnostics, setLoopDiagnostics] = useState<RadarLoopDiagnostics | null>(null);
  const [message, setMessage] = useState("On-device radar engine starting.");
  const [motionDir, setMotionDir] = useState("245");
  const [motionSpeed, setMotionSpeed] = useState("32");

  const refresh = async () => {
    const [nextStatus, nextCache] = await Promise.all([
      getRadarStatus("AUTO", "REF", 0.5),
      getRadarCacheStatus(),
    ]);
    setStatus(nextStatus);
    setCache(nextCache);
    setMapDiagnostics(readMapRuntimeDiagnostics());
    setAtlasDiagnostics(readAtlasDiagnostics());
    setLoopDiagnostics(readRadarLoopDiagnostics());
    setMessage(nextStatus.latestError || `${nextStatus.processingState}  - Level III products deferred`);
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const applyMotion = async () => {
    const motion = await setRadarStormMotion({ directionDegrees: Number(motionDir), speedKnots: Number(motionSpeed), source: "MANUAL" });
    setMessage(`Storm motion ${Math.round(motion.directionDegrees)} deg at ${Math.round(motion.speedKnots)} kt saved for SRV.`);
    await refresh();
  };

  const clearCache = async () => {
    await clearRadarCache();
    setMessage("Radar cache cleared.");
    await refresh();
  };

  return (
    <section className="cb-panel endpoint-panel radar-endpoint-panel">
      <div className="cb-panel__title"><span className="panel-glyph" aria-hidden="true" />Radar Engine</div>
      <div className="endpoint-form radar-engine-form">
        <div className="radar-engine-grid">
          <div className="radar-engine-metric"><span>Engine</span><strong>{status?.backendState === "ON_DEVICE" ? "ON DEVICE" : "STARTING"}</strong></div>
          <div className="radar-engine-metric"><span>Source</span><strong>NOAA LEVEL II</strong></div>
          <div className="radar-engine-metric"><span>Selected Site</span><strong>{status?.selectedSite ?? "AUTO"}</strong></div>
          <div className="radar-engine-metric"><span>Download</span><strong>{status?.currentFrameId ? "CURRENT" : "WAITING"}</strong></div>
          <div className="radar-engine-metric"><span>Decoder</span><strong>{status?.processingState ?? "READY"}</strong></div>
          <div className="radar-engine-metric"><span>REF</span><strong>{!status ? "--" : status.availableProducts.includes("REF") ? "AVAILABLE" : "UNAVAILABLE"}</strong></div>
          <div className="radar-engine-metric"><span>VEL</span><strong>{!status ? "--" : status.availableProducts.includes("VEL") ? "AVAILABLE" : "UNAVAILABLE"}</strong></div>
          <div className="radar-engine-metric"><span>SRV</span><strong>{!status ? "--" : status.availableProducts.includes("SRV") ? "AVAILABLE" : "UNAVAILABLE"}</strong></div>
          <div className="radar-engine-metric"><span>CC</span><strong>{!status ? "--" : status.availableProducts.includes("CC") ? "AVAILABLE" : "UNAVAILABLE"}</strong></div>
          <div className="radar-engine-metric"><span>Level III</span><strong>DEFERRED</strong></div>
          <div className="radar-engine-metric"><span>Cache</span><strong>{cache ? `${sizeLabel(cache.usedBytes)} / ${sizeLabel(cache.limitBytes)}` : "LOADING"}</strong></div>
          <div className="radar-engine-metric"><span>Frames</span><strong>{cache ? `${cache.frames}` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Background</span><strong>OFF</strong></div>
          <div className="radar-engine-metric"><span>Map Renderer</span><strong>{mapDiagnostics?.renderer ?? "WAITING"}</strong></div>
          <div className="radar-engine-metric"><span>Map Style</span><strong>{mapDiagnostics?.styleUri.replace("mapbox://styles/", "") ?? "UNKNOWN"}</strong></div>
          <div className="radar-engine-metric"><span>Style Layers</span><strong>{mapDiagnostics ? `${mapDiagnostics.modifiedLayers} MODIFIED` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Camera</span><strong>{mapDiagnostics ? `${mapDiagnostics.cameraMode.toUpperCase()}  - Z${mapDiagnostics.zoom}` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Bearing / Pitch</span><strong>{mapDiagnostics ? `${mapDiagnostics.bearing}° / ${mapDiagnostics.pitch}°` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Radar Opacity</span><strong>{mapDiagnostics ? `${Math.round(mapDiagnostics.radarOpacity * 100)}%  - ${mapDiagnostics.product}` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>GPS Accuracy</span><strong>{mapDiagnostics?.gpsAccuracyM != null ? `${Math.round(mapDiagnostics.gpsAccuracyM)} M` : "UNKNOWN"}</strong></div>
          <div className="radar-engine-metric"><span>Camera Speed</span><strong>{mapDiagnostics?.speedMph != null ? `${Math.round(mapDiagnostics.speedMph)} MPH` : "UNKNOWN"}</strong></div>
          <div className="radar-engine-metric"><span>Atlas Version</span><strong>{atlasDiagnostics?.mapboxVersion ?? "NOT ACTIVE"}</strong></div>
          <div className="radar-engine-metric"><span>Atlas Sources</span><strong>{atlasDiagnostics ? `${atlasDiagnostics.sourceCount}` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Atlas Layers</span><strong>{atlasDiagnostics ? `${atlasDiagnostics.layerCount}` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Atlas Instances</span><strong>{atlasDiagnostics ? `${atlasDiagnostics.mapInstanceCount}` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Atlas Radar</span><strong>{atlasDiagnostics?.radarLayerLoaded ? "LOADED" : "WAITING"}</strong></div>
          <div className="radar-engine-metric"><span>Atlas Error</span><strong>{atlasDiagnostics?.lastMapError || "NONE"}</strong></div>
          <div className="radar-engine-metric"><span>Loop State</span><strong>{loopDiagnostics?.playbackState ?? "WAITING"}</strong></div>
          <div className="radar-engine-metric"><span>Loop Speed</span><strong>{loopDiagnostics ? `${loopDiagnostics.playbackSpeed}X` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Loop Frames</span><strong>{loopDiagnostics ? `${loopDiagnostics.activeFrameIndex + 1} / ${loopDiagnostics.frameCount}` : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Newest Scan</span><strong>{loopDiagnostics?.newestScanTimestamp ? new Date(loopDiagnostics.newestScanTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Oldest Scan</span><strong>{loopDiagnostics?.oldestScanTimestamp ? new Date(loopDiagnostics.oldestScanTimestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--"}</strong></div>
          <div className="radar-engine-metric"><span>Live Edge</span><strong>{loopDiagnostics?.liveEdge ? "YES" : "NO"}</strong></div>
          <div className="radar-engine-metric"><span>Loop Errors</span><strong>{loopDiagnostics?.lastPlaybackError || "NONE"}</strong></div>
          <div className="radar-engine-metric"><span>Invalid Frames</span><strong>{loopDiagnostics?.skippedInvalidFrames ?? 0}</strong></div>
        </div>
        <div className="radar-engine-message">{message}</div>
        <div className="storm-motion-form">
          <span>SRV manual storm motion</span>
          <input value={motionDir} onChange={(event) => setMotionDir(event.target.value)} inputMode="numeric" aria-label="Storm motion direction degrees" />
          <input value={motionSpeed} onChange={(event) => setMotionSpeed(event.target.value)} inputMode="numeric" aria-label="Storm motion speed knots" />
          <button onClick={applyMotion}>Apply</button>
          <button onClick={clearCache}>Clear Cache</button>
        </div>
      </div>
    </section>
  );
}
