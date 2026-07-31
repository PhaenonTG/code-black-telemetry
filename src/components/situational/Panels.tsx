import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useWeather, useWind } from "../../hooks/useTelemetry";
import { AtlasMap } from "../../map/AtlasMap";
import { basemapProvider, basemapStatusLabel, basemapTileUrl, configuredMapEngine, mapboxDiagnostics, mapboxStyleId, probeMapboxRuntime, writeMapRuntimeDiagnostics, type MapEngine } from "../../services/mapTiles";
import { type AlertProduct, type ExternalObservation } from "../../services/situational";
import { sourceLabel, type CanonicalLocation } from "../../services/location";
import { ageLabel, cardinalFromDeg, freshness, valueText } from "../../services/telemetry/quality";
import {
  ageText,
  getNearestRadarSites,
  getRadarFrames,
  getRadarStatus,
  radarTileUrl,
  setRadarStormMotion,
  type RadarFrame,
  type RadarProduct,
  type RadarSite,
  type RadarStatus,
} from "../../services/radar";
import {
  buildFrameSeries,
  nextHistoricalIndex,
  nextPlaybackIndex,
  playbackDelayMs,
  previousHistoricalIndex,
  writeRadarLoopDiagnostics,
  type RadarPlaybackSpeed,
} from "../../services/radarLoop";
import type { CockpitMode } from "../../App";

function Panel({ title, children, className = "", tone = "default" }: { title: string; children: React.ReactNode; className?: string; tone?: "default" | "red" | "spc" }) {
  const toneClass = tone === "red" ? "cb-panel--red" : tone === "spc" ? "cb-panel--spc" : "";
  return (
    <section className={`cb-panel ${toneClass} ${className}`} data-tone={tone}>
      <div className="cb-panel__title"><span className="panel-glyph" aria-hidden="true" />{title}</div>
      {children}
    </section>
  );
}

function SourceBadge({ children, state }: { children: React.ReactNode; state?: string }) {
  return <span className={`cb-badge ${state ? `cb-badge--${state.toLowerCase()}` : ""}`}>{children}</span>;
}

function localTime(value: string | number | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function MetricTile({ icon, label, value, unit, accent = "default" }: { icon?: string; label: string; value: React.ReactNode; unit?: React.ReactNode; accent?: "default" | "red" | "blue" | "amber" | "green" }) {
  const labelClass = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <div className={`metric-tile metric-tile--${accent} metric-tile--${labelClass}`}>
      {icon && <i aria-hidden="true">{icon}</i>}
      <strong>{value}</strong>
      <span>{label}</span>
      {unit && <em>{unit}</em>}
    </div>
  );
}

export function LocationMotionPanel({ tabletPermission, location, mode }: { tabletPermission: string; location: CanonicalLocation; mode: CockpitMode }) {
  const valid = location.validity === "VALID" && location.latitude != null && location.longitude != null;
  const source = sourceLabel(location.source);
  const title = location.resolvedCity && location.resolvedState ? `NEAR ${location.resolvedCity}, ${location.resolvedState}` : valid ? "CURRENT POSITION" : "GPS ACQUIRING";
  const county = location.resolvedCounty ?? (valid ? "LOCALITY RESOLVING" : "NO CURRENT GPS FIX");
  return (
    <Panel title="Location & Motion" className={`loc-panel cockpit-card cockpit-card--${mode}`}>
      <div className="loc-head cockpit-head">
        <div>
          <div className="loc-city">{title}</div>
          <div className="loc-county">{county}</div>
        </div>
        <SourceBadge state={location.freshness}>GPS: {source}</SourceBadge>
      </div>
      <div className="cockpit-primary cockpit-primary--motion">
        <MetricTile label="Speed" value={valueText(location.speedMph, 1)} unit="mph" />
        <MetricTile label="Heading" value={location.headingCardinal || cardinalFromDeg(location.headingDeg)} unit={`${valueText(location.headingDeg, 0)} deg`} />
        {mode === "normal" && <MetricTile label="Elevation" value={valueText(location.altitudeFt, 0)} unit="ft" />}
        {mode === "chase" && <MetricTile label="GPS" value={location.fixState.replace("_", " ")} unit={location.accuracyM != null ? `${Math.round(location.accuracyM)} m` : location.freshness} />}
      </div>
      <div className="loc-footer cockpit-footer">
        {mode === "normal" && <><div><span>Lat</span><strong>{valid ? location.latitude!.toFixed(5) : "--"}</strong></div><div><span>Lon</span><strong>{valid ? location.longitude!.toFixed(5) : "--"}</strong></div></>}
        <div><span>Fix</span><strong>{location.fixState.replace("_", " ")}</strong></div>
        {mode === "chase" && <div><span>Age</span><strong>{location.timestamp ? ageLabel(location.timestamp) : "NO FIX"}</strong></div>}
      </div>
      {tabletPermission === "denied" && <div className="cb-note cb-note--warn">Tablet GPS denied. Holding last valid source.</div>}
      {!valid && <div className="cb-note cb-note--warn">{location.fallbackReason}</div>}
    </Panel>
  );
}

export function WeatherObservationPanel({ external, mode }: { external: ExternalObservation | null; mode: CockpitMode }) {
  const wx = useWeather();
  const source = wx?.source === "vehicle" ? "VEHICLE" : wx?.source === "simulator" ? "SIMULATOR  - DEV" : wx?.sourceLabel ?? "UNAVAILABLE";
  const obs = wx?.source !== "vehicle" && external ? external : null;
  const temp = wx?.source === "vehicle" ? wx.tempF : obs?.tempF ?? wx?.tempF;
  const dew = wx?.source === "vehicle" ? wx.dewpointF : obs?.dewpointF ?? wx?.dewpointF;
  const humidity = wx?.source === "vehicle" ? wx.humidity : obs?.humidity ?? wx?.humidity;
  const pressure = wx?.source === "vehicle" ? wx.pressureMb : obs?.pressureMb ?? wx?.pressureMb;
  const spread = temp != null && dew != null ? temp - dew : null;
  const stationLabel = obs ? `${obs.station} · ${Number.isFinite(obs.distanceMi) ? `${obs.distanceMi.toFixed(0)} MI` : "DISTANCE UNKNOWN"}` : source;
  const age = obs ? ageLabel(obs.updatedAt) : ageLabel(wx?.updatedAt);
  return (
    <Panel title={mode === "chase" ? "Conditions" : "Weather Observations"} className={`wx-panel cockpit-card cockpit-card--${mode}`}>
      <div className="panel-toolbar panel-toolbar--weather cockpit-toolbar">
        <SourceBadge state={obs ? "fallback" : freshness(wx?.updatedAt)}>SOURCE: {stationLabel}</SourceBadge>
        <span>{age}</span>
      </div>
      <div className="cockpit-primary cockpit-primary--conditions">
        <MetricTile icon="T" label="Temp" value={valueText(temp, 1)} unit="deg F" accent="red" />
        <MetricTile icon="D" label="Dew" value={dew == null ? "--" : dew.toFixed(0)} unit="deg F" accent="blue" />
        {mode === "chase" ? <MetricTile icon="S" label="Spread" value={valueText(spread, 0)} unit="deg" accent="amber" /> : <MetricTile icon="%" label="RH" value={valueText(humidity, 0)} unit="%" accent="blue" />}
        <MetricTile icon="P" label={mode === "chase" ? "P Trend" : "Pressure"} value={mode === "chase" ? wx?.pressureTrend?.toUpperCase() ?? "--" : valueText(pressure, 0)} unit={mode === "chase" ? "baro" : "mb"} accent={wx?.pressureTrend === "rising" ? "green" : "blue"} />
      </div>
      <div className="cockpit-secondary cockpit-secondary--conditions">
        <MetricTile label="RH" value={valueText(humidity, 0)} unit="%" />
        <MetricTile label="Rain" value={valueText(wx?.rainRateInHr, 2)} unit="in/hr" />
        {mode === "normal" && <MetricTile label="Total" value={valueText(wx?.rainTotalIn, 2)} unit="in" />}
        <MetricTile label="Age" value={age.replace(" AGO", "").replace(" MIN", "M").replace(" SEC", "S")} unit="obs" />
      </div>
    </Panel>
  );
}

export function WindAwarenessPanel({ external, mode }: { external: ExternalObservation | null; mode: CockpitMode }) {
  const wind = useWind();
  const useExternal = (!wind || wind.speedMph === null || wind.source === "simulator" || wind.source === "unavailable") && external?.windSpeedMph != null;
  const speed = useExternal ? external?.windSpeedMph ?? null : wind?.speedMph ?? null;
  const gust = useExternal ? external?.windGustMph ?? null : wind?.gustMph ?? null;
  const direction = useExternal ? external?.windDirectionDeg ?? null : wind?.directionDeg ?? null;
  const cardinal = cardinalFromDeg(direction);
  const stateText = speed === null ? "TREND UNAVAILABLE" : useExternal ? `${external?.station}  - ${external && Number.isFinite(external.distanceMi) ? `${external.distanceMi.toFixed(0)} MI` : "DISTANCE UNKNOWN"}  - ${ageLabel(external?.updatedAt)}` : ageLabel(wind?.updatedAt);
  const windSource = useExternal ? `USING ${external?.station}` : wind?.source === "vehicle" ? "VEHICLE SENSOR" : wind?.source === "last-known" ? "LAST VALID WIND" : "VEHICLE SENSOR OFFLINE";
  return (
    <Panel title="Wind" className={`wind-panel cockpit-card cockpit-card--${mode}`} tone="red">
      <div className="wind-compass wind-compass--compact" title="Meteorological wind direction: direction wind is coming from" style={{ ["--wind-rot" as string]: `${direction ?? 0}deg` }}>
        <div className="wind-ring" aria-hidden="true" />
        <div className="wind-arrow" />
        <span>{cardinal}<em>{direction == null ? "--" : `${direction.toFixed(0)} deg`}</em></span>
      </div>
      <div className="wind-readout">
        <strong>{speed === null ? "--" : Math.round(speed)}</strong>
        <span>mph sustained</span>
        <div>GUST {gust == null ? "--" : Math.round(gust)} mph</div>
        <div className="wind-trend-label">{mode === "chase" ? "5 min trend" : "Wind trend (last 5 min)"}</div>
        <svg className="wind-spark" viewBox="0 0 160 44" aria-hidden="true">
          {speed === null ? <text x="18" y="27">TREND UNAVAILABLE</text> : <path d="M0 36 L14 30 L28 33 L42 25 L56 28 L70 18 L84 22 L98 11 L112 18 L126 24 L140 19 L160 12" />}
        </svg>
      </div>
      <div className="panel-toolbar wind-toolbar">
        <SourceBadge state={useExternal ? "fallback" : freshness(wind?.updatedAt)}>WIND {windSource}</SourceBadge>
        <span>{stateText}</span>
      </div>
    </Panel>
  );
}

export function AlertsPanel({ products, error }: { products: AlertProduct[]; error: string }) {
  const [selected, setSelected] = useState<AlertProduct | null>(null);
  return (
    <Panel title={`Active Alerts ${products.length ? products.length : ""}`} className="alerts-panel" tone={products.some((p) => p.severity === "tornado" || p.severity === "pds") ? "red" : "spc"}>
      <div className="alert-list">
        {products.length === 0 && <div className="calm-card">{error ? "ALERT DATA TEMPORARILY UNAVAILABLE" : "NO ACTIVE LOCATION-MATCHED PRODUCTS"}</div>}
        {products.slice(0, 3).map((product) => (
          <button key={product.id} className={`alert-pill alert-pill--${product.severity}`} onClick={() => setSelected(product)}>
            <i aria-hidden="true">{product.severity === "md" ? "MD" : product.severity === "watch" ? "W" : "!"}</i>
            <span>{product.title}</span>
            <strong>{product.headline}</strong>
            <em>{product.expires ? `Expires ${product.expires}` : product.source}</em>
          </button>
        ))}
        {products.length === 1 && <div className="calm-card calm-card--secondary">NO ADDITIONAL LOCAL PRODUCTS</div>}
        <button className="view-all-button" onClick={() => undefined}>View All Alerts</button>
      </div>
      {selected && <ProductModal product={selected} onClose={() => setSelected(null)} />}
    </Panel>
  );
}

export function StormThreatsPanel({ products }: { products: AlertProduct[] }) {
  const [selected, setSelected] = useState<AlertProduct | null>(null);
  const watch = products.find((product) => product.type === "watch");
  const md = products.find((product) => product.type === "md");
  const warning = products.find((product) => product.type === "warning");
  return (
    <Panel title="Current Storm Threats" className="threats-panel" tone="spc">
      <div className="threat-list">
        {watch ? (
          <button className="threat-card threat-card--watch" onClick={() => setSelected(watch)}>
            <span>{watch.title}</span>
            <strong>{watch.headline}</strong>
            <em>Valid until {watch.expires || "--"}</em>
          </button>
        ) : (
          <div className="threat-card threat-card--watch threat-card--empty"><span>Watch Status</span><strong>No active local watch</strong><em>NWS/SPC source</em></div>
        )}
        {md ? (
          <button className="threat-card threat-card--md" onClick={() => setSelected(md)}>
            <span>{md.title}</span>
            <strong>{md.insideText ?? md.headline}</strong>
            <em>{md.expires ? `Expires ${md.expires}` : "SPC mesoscale discussion"}</em>
          </button>
        ) : (
          <div className="threat-card threat-card--md threat-card--empty"><span>Mesoscale Discussion</span><strong>No active local MD</strong><em>Current location clear</em></div>
        )}
        {warning ? (
          <button className={`threat-card threat-card--${warning.severity}`} onClick={() => setSelected(warning)}>
            <span>{warning.title}</span>
            <strong>{warning.headline}</strong>
            <em>{warning.expires ? `Expires ${warning.expires}` : warning.source}</em>
          </button>
        ) : (
          <div className="threat-card threat-card--risk threat-card--empty"><span>SPC Outlook</span><strong>No current local SPC threat data</strong><em>Source: SPC</em></div>
        )}
        <button className="view-all-button" onClick={() => undefined}>View All Products</button>
      </div>
      {selected && <ProductModal product={selected} onClose={() => setSelected(null)} />}
    </Panel>
  );
}

function ProductModal({ product, onClose }: { product: AlertProduct; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="product-title">
      <div className="product-modal">
        <div className="modal-head">
          <div>
            <div className="cb-panel__title">{product.source} Product</div>
            <h2 id="product-title">{product.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close detail panel">X</button>
        </div>
        <div className="modal-meta">
          <span>ISSUED {product.sent || "--"}</span>
          <span>EXPIRES {product.expires || "--"}</span>
          {product.watchProbability && <span>WATCH PROB {product.watchProbability}</span>}
        </div>
        <div className="modal-scroll">
          <h3>{product.headline}</h3>
          <p>{product.area}</p>
          <pre>{product.description || "No full text available from source."}</pre>
          {product.instruction && <pre>{product.instruction}</pre>}
          {product.relatedWatch && <p>Related watch: {product.relatedWatch}</p>}
          {product.url && <p>Source: {product.url}</p>}
        </div>
      </div>
    </div>
  );
}

function tilePoint(lat: number, lon: number, z: number) {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** z;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n,
  };
}

function lonLatFromTilePoint(x: number, y: number, z: number) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return {
    lat: (latRad * 180) / Math.PI,
    lon,
  };
}

function shortestAngleDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function smoothAngle(from: number, to: number, factor: number) {
  return (from + shortestAngleDelta(from, to) * factor + 360) % 360;
}

function destinationPoint(lat: number, lon: number, bearingDeg: number, miles: number) {
  const radiusMiles = 3958.7613;
  const distance = miles / radiusMiles;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance) + Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1), Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2));
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: ((((lon2 * 180) / Math.PI) + 540) % 360) - 180,
  };
}

function zoomForSpeed(speedMph: number | null | undefined, expanded: boolean) {
  const speed = speedMph ?? 0;
  if (speed < 5) return expanded ? 9.2 : 8.2;
  if (speed < 35) return expanded ? 8.8 : 7.95;
  if (speed < 65) return expanded ? 8.35 : 7.55;
  return expanded ? 8.0 : 7.25;
}

function lookAheadMilesForZoom(zoom: number, speedMph: number | null | undefined) {
  const speedFactor = Math.min(Math.max((speedMph ?? 0) / 65, 0), 1);
  return Math.max(3, (13 - zoom) * (1.4 + speedFactor));
}

function defaultRadarOpacity(product: RadarProduct) {
  if (product === "REF") return 0.74;
  if (product === "VEL" || product === "SRV") return 0.78;
  if (product === "CC") return 0.7;
  return 0.7;
}

type MapCameraMode = "free" | "follow-north" | "follow-heading" | "recentering";

type MapRadarPanelProps = {
  gps: { lat: number; lon: number; headingDeg: number | null; speedMph?: number | null; accuracyM?: number | null } | null;
  visible?: boolean;
  allowExpand?: boolean;
  productOverride?: RadarProduct;
  onProductOverrideChange?: (product: RadarProduct) => void;
  frameOverride?: RadarFrame | null;
  playbackContext?: { playing: boolean; frameIndex: number; frameCount: number };
};

export function MapRadarPanel(props: MapRadarPanelProps) {
  const [engine, setEngine] = useState<MapEngine>(() => configuredMapEngine());
  useEffect(() => {
    const handleEngineChange = () => setEngine(configuredMapEngine());
    window.addEventListener("codeblack:map-engine-change", handleEngineChange);
    return () => window.removeEventListener("codeblack:map-engine-change", handleEngineChange);
  }, []);
  return engine === "atlas" ? <AtlasMapRadarPanel {...props} /> : <LegacyMapRadarPanel {...props} />;
}

function AtlasMapRadarPanel({
  gps,
  visible = true,
  allowExpand = true,
  productOverride,
  onProductOverrideChange,
  frameOverride,
  playbackContext,
}: MapRadarPanelProps) {
  const [radarVisible, setRadarVisible] = useState(true);
  const [internalProduct, setInternalProduct] = useState<RadarProduct>("REF");
  const product = productOverride ?? internalProduct;
  const setProduct = onProductOverrideChange ?? setInternalProduct;
  const [site, setSite] = useState("AUTO");
  const [nearestSites, setNearestSites] = useState<RadarSite[]>([]);
  const [frame, setFrame] = useState<RadarFrame | null>(null);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<RadarPlaybackSpeed>(1);
  const [opacity, setOpacity] = useState(() => defaultRadarOpacity(product));
  const [rangeRings, setRangeRings] = useState<"off" | "10" | "25" | "50" | "100">("off");
  const [expanded, setExpanded] = useState(false);
  const [radarError, setRadarError] = useState("");
  const activeSite = site === "AUTO" ? nearestSites[0]?.id ?? "KSRX" : site;
  const selectedTilt = status?.selectedTilt ?? 1;
  const gpsLat = gps?.lat;
  const gpsLon = gps?.lon;

  useEffect(() => {
    if (gpsLat == null || gpsLon == null || !visible) return;
    let cancelled = false;
    getNearestRadarSites(gpsLat, gpsLon).then((sites) => {
      if (!cancelled) setNearestSites(sites);
    }).catch(() => {
      if (!cancelled) setRadarError("ON-DEVICE SITE LIST UNAVAILABLE");
    });
    return () => {
      cancelled = true;
    };
  }, [gpsLat, gpsLon, visible]);

  useEffect(() => {
    if (!visible || !activeSite) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [nextStatus, nextFrames] = await Promise.all([
          getRadarStatus(activeSite, product, selectedTilt),
          getRadarFrames(activeSite, product, selectedTilt, 6),
        ]);
        if (!cancelled) {
          setStatus(nextStatus);
          const orderedFrames = buildFrameSeries(product, nextFrames, null, "LIVE_EDGE", 1).frames.map((item) => item.frame);
          setFrames(orderedFrames);
          setFrameIndex(0);
          setFrame(orderedFrames[0] ?? null);
          setRadarError(orderedFrames[0] ? "" : nextStatus.latestError || "");
        }
      } catch (error) {
        if (!cancelled) setRadarError(error instanceof Error ? error.message : "ON-DEVICE RADAR UNAVAILABLE");
      }
    };
    void load();
    const timer = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSite, product, selectedTilt, visible]);

  useEffect(() => {
    if (!playing || !frames.length || document.hidden) return;
    const timer = window.setInterval(() => {
      setFrameIndex((index) => {
        const next = nextPlaybackIndex(index, frames.length);
        setFrame(frames[next]);
        return next;
      });
    }, playbackDelayMs(playbackSpeed));
    return () => window.clearInterval(timer);
  }, [playing, frames, playbackSpeed]);

  const displayFrame = frameOverride === undefined ? frame : frameOverride;
  const activeFrame = displayFrame ?? frame;
  const loopSeries = useMemo(
    () => buildFrameSeries(product, frames, activeFrame?.frameId ?? null, playing ? "PLAYING" : "PAUSED", playbackSpeed),
    [activeFrame?.frameId, frames, playbackSpeed, playing, product],
  );

  useEffect(() => {
    writeRadarLoopDiagnostics({
      loopEnabled: playing,
      playbackState: loopSeries.playbackState,
      playbackSpeed,
      selectedProduct: product,
      frameCount: loopSeries.frames.length,
      activeFrameIndex: loopSeries.activeFrameIndex,
      newestScanTimestamp: loopSeries.frames[0]?.scanTimestamp ?? null,
      oldestScanTimestamp: loopSeries.frames[loopSeries.frames.length - 1]?.scanTimestamp ?? null,
      activeScanTimestamp: activeFrame?.time ?? null,
      activeFrameAgeSeconds: activeFrame?.ageSeconds ?? null,
      liveEdge: loopSeries.liveEdge,
      cacheDirectory: "APP_PRIVATE_RADAR_CACHE",
      cacheDiskUsageBytes: null,
      objectUrlCount: 0,
      imageLoadRequestId: 0,
      sourceUpdateCount: 0,
      staleUpdateRejectionCount: 0,
      activeTextureEstimateBytes: activeFrame?.imageUrl ? null : 0,
      lastPlaybackError: radarError,
      lastCacheError: "",
      skippedInvalidFrames: loopSeries.frames.filter((item) => item.validityState !== "VALID").length,
      updatedAt: Date.now(),
    });
  }, [activeFrame, frames, loopSeries, playbackSpeed, playing, product, radarError]);

  const applyProduct = (next: RadarProduct) => {
    setProduct(next);
    setOpacity(defaultRadarOpacity(next));
    setPlaying(false);
    setFrame(null);
    setFrames([]);
    setFrameIndex(0);
    setRadarError("");
    if (next === "SRV" && !status?.stormMotion) setRadarError("SRV UNAVAILABLE - SET STORM MOTION");
  };

  const radarLayerActive = radarVisible && activeFrame && !radarError.includes("UNAVAILABLE");
  const historicalLabel = activeFrame && !loopSeries.liveEdge ? "HISTORICAL" : activeFrame?.freshness;
  const scanLabel = activeFrame ? `SCAN ${localTime(activeFrame.time)}  - AGE ${ageText(activeFrame.ageSeconds)}` : radarError || "LOADING";

  return (
    <Panel title="Situational Map" className="map-panel map-panel--atlas">
      <div className="map-canvas atlas-host" data-map-gesture-zone="true">
        <AtlasMap
          gps={gps}
          frame={radarLayerActive ? activeFrame : null}
          product={product}
          opacity={opacity}
          expanded={!allowExpand}
          rangeRings={rangeRings}
          onRangeRingsChange={setRangeRings}
          onOpenExpanded={allowExpand ? () => setExpanded(true) : undefined}
          statusLabel={radarError ? `ATLAS  - ${radarError}` : activeFrame ? `${product}  - ${activeFrame.site.id}  - ${activeFrame.sourceLevel}  - ${historicalLabel}` : "ATLAS  - RADAR LOADING"}
          scanLabel={playbackContext?.playing ? `${scanLabel}  - LOOPING ${playbackContext.frameIndex + 1}/${playbackContext.frameCount}` : scanLabel}
        />
      </div>
      <div className="atlas-product-mini" aria-label="Radar product selector">
        {(["REF", "VEL", "SRV", "CC"] as RadarProduct[]).map((item) => (
          <button key={item} className={item === product ? "active" : ""} onClick={() => applyProduct(item)}>{item}</button>
        ))}
        <button onClick={() => setRadarVisible((value) => !value)}>{radarVisible ? "RADAR ON" : "RADAR OFF"}</button>
      </div>
      {allowExpand && expanded && typeof document !== "undefined" && createPortal(
        <RadarExpandedView
          active={expanded}
          gps={gps}
          product={product}
          setProduct={applyProduct}
          site={site}
          setSite={setSite}
          nearestSites={nearestSites}
          frame={frame}
          frames={frames}
          frameIndex={frameIndex}
          setFrameIndex={(index) => {
            setFrameIndex(index);
            setFrame(frames[index] ?? frame);
          }}
          playing={playing}
          setPlaying={setPlaying}
          playbackSpeed={playbackSpeed}
          setPlaybackSpeed={setPlaybackSpeed}
          opacity={opacity}
          setOpacity={setOpacity}
          rangeRings={rangeRings === "10" || rangeRings === "100" ? "25" : rangeRings}
          setRangeRings={(mode) => setRangeRings(mode)}
          radarError={radarError}
          status={status}
          onClose={() => setExpanded(false)}
        />,
        document.body,
      )}
    </Panel>
  );
}

function LegacyMapRadarPanel({
  gps,
  visible = true,
  allowExpand = true,
  productOverride,
  onProductOverrideChange,
}: MapRadarPanelProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; center: { lat: number; lon: number }; moved: boolean } | null>(null);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [mapboxState, setMapboxState] = useState(() => mapboxDiagnostics());
  const [radarVisible, setRadarVisible] = useState(true);
  const [internalProduct, setInternalProduct] = useState<RadarProduct>("REF");
  const product = productOverride ?? internalProduct;
  const setProduct = onProductOverrideChange ?? setInternalProduct;
  const [site, setSite] = useState("AUTO");
  const [nearestSites, setNearestSites] = useState<RadarSite[]>([]);
  const [frame, setFrame] = useState<RadarFrame | null>(null);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<RadarPlaybackSpeed>(1);
  const [opacity, setOpacity] = useState(0.78);
  const [rangeRings, setRangeRings] = useState<"off" | "25" | "50">("off");
  const [expanded, setExpanded] = useState(false);
  const [radarError, setRadarError] = useState("");
  const [cameraMode, setCameraMode] = useState<MapCameraMode>("follow-north");
  const [cameraCenter, setCameraCenter] = useState(() => gps ? { lat: gps.lat, lon: gps.lon } : null);
  const [zoom, setZoom] = useState(() => zoomForSpeed(gps?.speedMph, !allowExpand));
  const [cameraBearing, setCameraBearing] = useState(gps?.headingDeg ?? 0);
  const provider = basemapFailed ? "osm" : basemapProvider();
  const activeSite = site === "AUTO" ? nearestSites[0]?.id ?? "KSRX" : site;
  const gpsLat = gps?.lat;
  const gpsLon = gps?.lon;
  const selectedTilt = status?.selectedTilt ?? 1;
  const renderZoom = Math.round(zoom);
  const centerPoint = useMemo(() => cameraCenter ? tilePoint(cameraCenter.lat, cameraCenter.lon, renderZoom) : null, [cameraCenter, renderZoom]);
  const tileSizePct = 100 / 3;
  const tiles = useMemo(() => {
    if (!centerPoint || !visible) return [];
    const centerTile = { x: Math.floor(centerPoint.x), y: Math.floor(centerPoint.y) };
    const fracX = centerPoint.x - centerTile.x;
    const fracY = centerPoint.y - centerTile.y;
    const items: Array<{ key: string; x: number; y: number; left: number; top: number }> = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        items.push({
          key: `${centerTile.x + dx}-${centerTile.y + dy}`,
          x: centerTile.x + dx,
          y: centerTile.y + dy,
          left: (dx + 1.5 - fracX) * tileSizePct,
          top: (dy + 1.5 - fracY) * tileSizePct,
        });
      }
    }
    return items;
  }, [centerPoint, tileSizePct, visible]);
  const radarImageStyle = useMemo(() => {
    if (!centerPoint || !frame?.bounds) return null;
    const westNorth = tilePoint(frame.bounds.north, frame.bounds.west, renderZoom);
    const eastSouth = tilePoint(frame.bounds.south, frame.bounds.east, renderZoom);
    const leftPct = 50 + (westNorth.x - centerPoint.x) * tileSizePct;
    const topPct = 50 + (westNorth.y - centerPoint.y) * tileSizePct;
    const widthPct = (eastSouth.x - westNorth.x) * tileSizePct;
    const heightPct = (eastSouth.y - westNorth.y) * tileSizePct;
    return {
      left: `${leftPct}%`,
      top: `${topPct}%`,
      width: `${widthPct}%`,
      height: `${heightPct}%`,
      opacity,
    };
  }, [centerPoint, frame?.bounds, opacity, renderZoom, tileSizePct]);
  const gpsMarkerStyle = useMemo(() => {
    if (!gps || !centerPoint) return {};
    const point = tilePoint(gps.lat, gps.lon, renderZoom);
    return {
      left: `${50 + (point.x - centerPoint.x) * tileSizePct}%`,
      top: `${50 + (point.y - centerPoint.y) * tileSizePct}%`,
      ["--heading" as string]: `${(gps.headingDeg ?? 0) - (cameraMode === "follow-heading" ? cameraBearing : 0)}deg`,
    };
  }, [cameraBearing, cameraMode, centerPoint, gps, renderZoom, tileSizePct]);
  const mapBearingCss = cameraMode === "follow-heading" ? -cameraBearing : 0;
  const pitch = cameraMode === "follow-heading" && (gps?.speedMph ?? 0) >= 5 ? 18 : 0;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    probeMapboxRuntime().then((result) => {
      if (!cancelled) setMapboxState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (visible) setBasemapFailed(false);
  }, [visible]);

  useEffect(() => {
    if (!gps || !visible) return;
    setCameraCenter((current) => current ?? { lat: gps.lat, lon: gps.lon });
    if (cameraMode === "free") return;

    const nextZoom = zoomForSpeed(gps.speedMph, !allowExpand);
    setZoom((current) => Math.abs(current - nextZoom) > 0.28 ? current + (nextZoom - current) * 0.35 : current);

    const reliableHeading = gps.headingDeg != null && (gps.speedMph ?? 0) >= 4;
    const nextBearing = cameraMode === "follow-heading" && reliableHeading ? gps.headingDeg ?? cameraBearing : 0;
    setCameraBearing((current) => smoothAngle(current, nextBearing, cameraMode === "recentering" ? 0.55 : 0.22));

    setCameraCenter((current) => {
      const bearing = cameraMode === "follow-heading" && reliableHeading ? gps.headingDeg ?? cameraBearing : 0;
      const target = cameraMode === "follow-heading"
        ? destinationPoint(gps.lat, gps.lon, bearing, lookAheadMilesForZoom(zoom, gps.speedMph))
        : { lat: gps.lat, lon: gps.lon };
      if (!current || cameraMode === "recentering") return target;
      const currentPoint = tilePoint(current.lat, current.lon, renderZoom);
      const targetPoint = tilePoint(target.lat, target.lon, renderZoom);
      const distancePx = Math.hypot(targetPoint.x - currentPoint.x, targetPoint.y - currentPoint.y) * 256;
      if (distancePx < 8 && cameraMode !== "follow-heading") return current;
      const factor = cameraMode === "follow-heading" ? 0.2 : 0.28;
      return lonLatFromTilePoint(currentPoint.x + (targetPoint.x - currentPoint.x) * factor, currentPoint.y + (targetPoint.y - currentPoint.y) * factor, renderZoom);
    });

    if (cameraMode === "recentering") {
      const timer = window.setTimeout(() => setCameraMode("follow-north"), 900);
      return () => window.clearTimeout(timer);
    }
  }, [allowExpand, cameraBearing, cameraMode, gps, renderZoom, visible, zoom]);

  useEffect(() => {
    if (!visible) return;
    writeMapRuntimeDiagnostics({
      renderer: "react-raster-tile-grid",
      styleUri: `mapbox://styles/${mapboxStyleId()}`,
      styleLoaded: provider === "mapbox" && !basemapFailed,
      modifiedLayers: 0,
      missingTargetLayers: ["not-applicable-raster-tile-renderer"],
      zoom: renderZoom,
      bearing: Number(cameraBearing.toFixed(1)),
      pitch,
      cameraMode,
      gpsAccuracyM: gps?.accuracyM ?? null,
      speedMph: gps?.speedMph ?? null,
      radarOpacity: opacity,
      product,
      provider,
      updatedAt: Date.now(),
    });
  }, [basemapFailed, cameraBearing, cameraMode, gps?.accuracyM, gps?.speedMph, opacity, pitch, product, provider, renderZoom, visible]);

  useEffect(() => {
    if (gpsLat == null || gpsLon == null || !visible) return;
    let cancelled = false;
    getNearestRadarSites(gpsLat, gpsLon).then((sites) => {
      if (!cancelled) {
        setNearestSites(sites);
        if (site === "AUTO" && sites[0]) setRadarError("");
      }
    }).catch(() => {
      if (!cancelled) setRadarError("ON-DEVICE SITE LIST UNAVAILABLE");
    });
    return () => {
      cancelled = true;
    };
  }, [gpsLat, gpsLon, visible, site]);

  useEffect(() => {
    if (!visible || !activeSite) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [nextStatus, nextFrames] = await Promise.all([
          getRadarStatus(activeSite, product, selectedTilt),
          getRadarFrames(activeSite, product, selectedTilt, 6),
        ]);
        if (!cancelled) {
          setStatus(nextStatus);
          setFrames(nextFrames);
          setFrameIndex(0);
          setFrame(nextFrames[0] ?? null);
          setRadarError(nextFrames[0] ? "" : nextStatus.latestError || "");
        }
      } catch (error) {
        if (!cancelled) setRadarError(error instanceof Error ? error.message : "ON-DEVICE RADAR UNAVAILABLE");
      }
    };
    void load();
    const timer = window.setInterval(load, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeSite, product, selectedTilt, visible]);

  useEffect(() => {
    if (!playing || !frames.length || document.hidden) return;
    const timer = window.setInterval(() => {
      setFrameIndex((index) => {
        const next = (index + 1) % frames.length;
        setFrame(frames[next]);
        return next;
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [playing, frames]);

  const applyProduct = (next: RadarProduct) => {
    setProduct(next);
    setOpacity(defaultRadarOpacity(next));
    setPlaying(false);
    if (next === "SRV" && !status?.stormMotion) setRadarError("SRV UNAVAILABLE - SET STORM MOTION");
  };

  const recenterMap = useCallback((mode: MapCameraMode = "follow-north") => {
    if (!gps) return;
    const nextZoom = zoomForSpeed(gps.speedMph, !allowExpand);
    setCameraMode("recentering");
    setZoom(nextZoom);
    setCameraBearing(mode === "follow-heading" && gps.headingDeg != null ? gps.headingDeg : 0);
    setCameraCenter(mode === "follow-heading" && gps.headingDeg != null && (gps.speedMph ?? 0) >= 4
      ? destinationPoint(gps.lat, gps.lon, gps.headingDeg, lookAheadMilesForZoom(nextZoom, gps.speedMph))
      : { lat: gps.lat, lon: gps.lon });
    window.setTimeout(() => setCameraMode(mode), 350);
  }, [allowExpand, gps]);

  useEffect(() => {
    if (!visible) return;
    const handleCenter = () => recenterMap("follow-north");
    window.addEventListener("codeblack:center-map", handleCenter);
    return () => window.removeEventListener("codeblack:center-map", handleCenter);
  }, [recenterMap, visible]);

  const adjustZoom = (delta: number) => {
    setCameraMode("free");
    setZoom((current) => Math.min(11.8, Math.max(6.5, current + delta)));
  };

  const cycleFollowMode = () => {
    if (cameraMode === "follow-heading") recenterMap("follow-north");
    else recenterMap("follow-heading");
  };

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!cameraCenter || event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, center: cameraCenter, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    setCameraMode("free");
    const start = tilePoint(drag.center.lat, drag.center.lon, renderZoom);
    const tilePixels = Math.max(rect.width, rect.height) / 3;
    setCameraCenter(lonLatFromTilePoint(start.x - dx / tilePixels, start.y - dy / tilePixels, renderZoom));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      window.setTimeout(() => {
        dragRef.current = null;
      }, drag.moved ? 50 : 0);
    }
  };

  const radarLayerActive = radarVisible && frame && !radarError.includes("UNAVAILABLE");
  const scanLabel = frame ? `SCAN ${localTime(frame.time)}  - AGE ${ageText(frame.ageSeconds)}` : radarError || "LOADING";

  return (
    <Panel title="Situational Map" className="map-panel">
      <div
        ref={canvasRef}
        className="map-canvas"
        data-map-gesture-zone="true"
        data-camera-mode={cameraMode}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={allowExpand ? () => {
          if (!dragRef.current?.moved) setExpanded(true);
        } : undefined}
        onDoubleClick={allowExpand ? () => {
          if (!dragRef.current?.moved) setExpanded(true);
        } : undefined}
      >
        {gps ? (
          <>
            <div
              className="tile-grid"
              style={{
                ["--map-bearing" as string]: `${mapBearingCss}deg`,
                ["--map-rotation-scale" as string]: cameraMode === "follow-heading" ? 1.24 : 1,
              }}
            >
              {tiles.map((tile) => (
                <div key={tile.key} className="tile-cell" style={{ left: `${tile.left}%`, top: `${tile.top}%` }}>
                  <img
                    src={basemapTileUrl(renderZoom, tile.x, tile.y, provider)}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.opacity = "0";
                      if (provider === "mapbox") setBasemapFailed(true);
                    }}
                  />
                  {radarLayerActive && frame.tileTemplate && (
                    <img
                      className="radar-tile"
                      src={radarTileUrl(frame.frameId, renderZoom, tile.x, tile.y)}
                      style={{ opacity }}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.opacity = "0";
                      }}
                    />
                  )}
                </div>
              ))}
              {radarLayerActive && frame.imageUrl && radarImageStyle && (
                <img
                  className="radar-ref-image"
                  src={frame.imageUrl}
                  style={radarImageStyle}
                  alt=""
                  aria-hidden="true"
                />
              )}
            </div>
            {radarLayerActive && frame.imageUrl && !radarImageStyle && (
              <img
                className="radar-ref-image"
                src={frame.imageUrl}
                style={{ opacity }}
                alt=""
                aria-hidden="true"
              />
            )}
            <div className="position-marker" style={gpsMarkerStyle} />
            {frame && rangeRings !== "off" && <div className={`range-rings range-rings--${rangeRings}`} aria-hidden="true" />}
          </>
        ) : (
          <div className="offline-map">LOCATION REQUIRED FOR MAP</div>
        )}
        <div className="radar-strip">
          <button onClick={() => applyProduct(product === "REF" ? "VEL" : product === "VEL" ? "SRV" : product === "SRV" ? "CC" : "REF")}>{product}</button>
          <span>{frame ? `${frame.site.id}  - ${frame.sourceLevel}  - ${frame.freshness}` : "ON DEVICE"}</span>
          <em>{scanLabel}</em>
          <button aria-label="Toggle radar visibility" onClick={(event) => { event.stopPropagation(); setRadarVisible((value) => !value); }}>{radarVisible ? "RADAR" : "HIDDEN"}</button>
          {allowExpand && <button aria-label="Open expanded radar" onPointerDown={(event) => { event.stopPropagation(); setExpanded(true); }} onClick={(event) => { event.stopPropagation(); setExpanded(true); }}>OPEN</button>}
        </div>
        <div className="map-controls" aria-label="Map controls" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" aria-label="Zoom in" onClick={(event) => { event.stopPropagation(); adjustZoom(0.5); }}>+</button>
          <button type="button" aria-label="Zoom out" onClick={(event) => { event.stopPropagation(); adjustZoom(-0.5); }}>-</button>
          <button type="button" aria-label="Toggle follow mode" onClick={(event) => { event.stopPropagation(); cycleFollowMode(); }}>{cameraMode === "follow-heading" ? "HDG" : cameraMode === "free" ? "REC" : "NUP"}</button>
          <button type="button" aria-label="Toggle range rings" onClick={(event) => { event.stopPropagation(); setRangeRings((value) => value === "off" ? "25" : value === "25" ? "50" : "off"); }}>RNG</button>
        </div>
        <div className="radar-legend" aria-hidden="true">
          {(frame?.legend.stops ?? ["Light", "Moderate", "Heavy", "Extreme"]).slice(0, 6).map((stop) => <span key={String(stop)}>{stop}</span>)}
          {frame?.legend.units && <span>{frame.legend.units}</span>}
        </div>
        <div className="map-status">
          {radarError ? `${basemapStatusLabel(provider)}  - ${radarError}` : frame ? `${product}  - ${frame.site.id}  - ${frame.sourceLevel}  - ${frame.freshness}` : `${basemapStatusLabel(provider)}  - RADAR LOADING`}
          <span className="sr-only">{`Mapbox token present ${mapboxState.tokenPresent ? "yes" : "no"} prefix ${mapboxState.prefix} length ${mapboxState.tokenLength}`}</span>
        </div>
      </div>
      {allowExpand && typeof document !== "undefined" && createPortal(
        <RadarExpandedView
          active={expanded}
          gps={gps}
          product={product}
          setProduct={applyProduct}
          site={site}
          setSite={setSite}
          nearestSites={nearestSites}
          frame={frame}
          frames={frames}
          frameIndex={frameIndex}
          setFrameIndex={(index) => {
            setFrameIndex(index);
            setFrame(frames[index] ?? frame);
          }}
          playing={playing}
          setPlaying={setPlaying}
          playbackSpeed={playbackSpeed}
          setPlaybackSpeed={setPlaybackSpeed}
          opacity={opacity}
          setOpacity={setOpacity}
          rangeRings={rangeRings}
          setRangeRings={setRangeRings}
          radarError={radarError}
          status={status}
          onClose={() => setExpanded(false)}
        />,
        document.body,
      )}
    </Panel>
  );
}

function RadarExpandedView({
  active,
  gps,
  product,
  setProduct,
  site,
  setSite,
  nearestSites,
  frame,
  frames,
  frameIndex,
  setFrameIndex,
  playing,
  setPlaying,
  playbackSpeed,
  setPlaybackSpeed,
  opacity,
  setOpacity,
  rangeRings,
  setRangeRings,
  radarError,
  status,
  onClose,
}: {
  active: boolean;
  gps: { lat: number; lon: number; headingDeg: number | null } | null;
  product: RadarProduct;
  setProduct: (product: RadarProduct) => void;
  site: string;
  setSite: (site: string) => void;
  nearestSites: RadarSite[];
  frame: RadarFrame | null;
  frames: RadarFrame[];
  frameIndex: number;
  setFrameIndex: (index: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  playbackSpeed: RadarPlaybackSpeed;
  setPlaybackSpeed: (speed: RadarPlaybackSpeed) => void;
  opacity: number;
  setOpacity: (opacity: number) => void;
  rangeRings: "off" | "25" | "50";
  setRangeRings: (rings: "off" | "25" | "50") => void;
  radarError: string;
  status: RadarStatus | null;
  onClose: () => void;
}) {
  const [motionDir, setMotionDir] = useState("245");
  const [motionSpeed, setMotionSpeed] = useState("32");
  const [motionMessage, setMotionMessage] = useState("");
  const selectedSite = site === "AUTO" ? nearestSites[0]?.id ?? "KSRX" : site;
  const loopSeries = useMemo(
    () => buildFrameSeries(product, frames, frame?.frameId ?? null, playing ? "PLAYING" : "PAUSED", playbackSpeed),
    [frame?.frameId, frames, playbackSpeed, playing, product],
  );

  const selectFrame = (index: number, pause = true) => {
    const bounded = Math.min(Math.max(index, 0), Math.max(0, frames.length - 1));
    if (pause) setPlaying(false);
    setFrameIndex(bounded);
  };

  useEffect(() => {
    if (!active) return;
    const close = () => onClose();
    const keyClose = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.classList.add("radar-expanded-active");
    window.addEventListener("codeblack:close-radar", close);
    window.addEventListener("keydown", keyClose);
    return () => {
      document.body.classList.remove("radar-expanded-active");
      window.removeEventListener("codeblack:close-radar", close);
      window.removeEventListener("keydown", keyClose);
    };
  }, [active, onClose]);

  const applyMotion = async () => {
    const motion = await setRadarStormMotion({ directionDegrees: Number(motionDir), speedKnots: Number(motionSpeed), source: "MANUAL" });
    setMotionMessage(`${Math.round(motion.directionDegrees)} deg at ${Math.round(motion.speedKnots)} kt  - ${motion.source}`);
  };

  return (
    <div className={`modal-backdrop radar-expanded ${active ? "radar-expanded--active" : ""}`} role="dialog" aria-modal="true" aria-hidden={!active} aria-label="Expanded radar interrogation">
      <div className="radar-expanded__shell">
        <header className="radar-expanded__top">
          <button className="icon-button radar-expanded__close" onClick={onClose} aria-label="Close radar">X</button>
          <strong>{frame ? `${frame.site.id}  - ${frame.site.name}` : selectedSite}</strong>
          <span>{product}  - {frame?.sourceLevel ?? status?.sourceLevel ?? "RADAR"}  - {frame ? `SCAN ${localTime(frame.time)}  - AGE ${ageText(frame.ageSeconds)}` : "LOADING"}</span>
          <em>{radarError || (loopSeries.liveEdge ? "LIVE EDGE" : frame ? "HISTORICAL" : "CONNECTED")}</em>
        </header>
        <div className="radar-product-tabs">
          {(["REF", "VEL", "SRV", "CC"] as RadarProduct[]).map((item) => (
            <button key={item} className={item === product ? "active" : ""} onClick={() => setProduct(item)}>{item}</button>
          ))}
        </div>
        <div className="radar-expanded__map">
          <MapRadarPanel
            gps={gps}
            visible
            allowExpand={false}
            productOverride={product}
            onProductOverrideChange={setProduct}
            frameOverride={frame}
            playbackContext={{ playing, frameIndex, frameCount: frames.length }}
          />
          <div className="radar-expanded__overlay-note">{frame ? `${frame.product} ${frame.sourceLevel}  - ${loopSeries.liveEdge ? "LIVE EDGE" : "HISTORICAL"}  - ${localTime(frame.time)}  - ${frameIndex + 1}/${Math.max(frames.length, 1)}` : radarError || "Waiting for radar frame"}</div>
        </div>
        <aside className="radar-expanded__controls">
          <div className="radar-loop-control">
            <span>Loop</span>
            <button onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
            <button onClick={() => selectFrame(previousHistoricalIndex(frameIndex, frames.length))}>Prev</button>
            <button onClick={() => selectFrame(nextHistoricalIndex(frameIndex, frames.length))}>Next</button>
            <button onClick={() => selectFrame(0)}>Latest</button>
            <input
              type="range"
              min="0"
              max={Math.max(0, frames.length - 1)}
              value={Math.max(0, frameIndex)}
              onChange={(event) => selectFrame(Number(event.target.value))}
              aria-label="Radar frame timeline"
            />
            <strong>{frames.length ? `${frameIndex + 1} / ${frames.length}` : "0 / 0"}</strong>
            <em>{loopSeries.playbackState.replace("_", " ")}</em>
            <div className="radar-loop-speed">
              {([0.5, 1, 2] as RadarPlaybackSpeed[]).map((speed) => (
                <button key={speed} className={playbackSpeed === speed ? "active" : ""} onClick={() => setPlaybackSpeed(speed)}>{speed}x</button>
              ))}
            </div>
          </div>
          <div>
            <span>Tilt</span>
            <strong>{`${frame?.elevationAngle?.toFixed(1) ?? "--"} deg`}</strong>
            <em>{frame?.availableTilts?.length ? `${frame.availableTilts.length} cuts` : "No cuts"}</em>
          </div>
          <div>
            <span>Site</span>
            <button onClick={() => setSite("AUTO")}>AUTO</button>
            <button onClick={() => setSite(nearestSites[Math.max(0, nearestSites.findIndex((item) => item.id === selectedSite) - 1)]?.id ?? selectedSite)}>Prev</button>
            <button onClick={() => setSite(nearestSites[(nearestSites.findIndex((item) => item.id === selectedSite) + 1) % Math.max(1, nearestSites.length)]?.id ?? selectedSite)}>Next</button>
            <select value={site} onChange={(event) => setSite(event.target.value)}>
              <option value="AUTO">AUTO nearest</option>
              {nearestSites.map((item) => <option key={item.id} value={item.id}>{item.id}  - {item.name}</option>)}
            </select>
          </div>
          <label>
            <span>Opacity</span>
            <input type="range" min="0.25" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
          </label>
          <div>
            <span>Range rings</span>
            {(["off", "25", "50"] as const).map((value) => <button key={value} className={rangeRings === value ? "active" : ""} onClick={() => setRangeRings(value)}>{value === "off" ? "Off" : `${value} nm`}</button>)}
          </div>
          {product === "SRV" && (
            <div className="srv-motion-control">
              <span>Storm motion</span>
              <input value={motionDir} onChange={(event) => setMotionDir(event.target.value)} inputMode="numeric" aria-label="Storm motion degrees" />
              <input value={motionSpeed} onChange={(event) => setMotionSpeed(event.target.value)} inputMode="numeric" aria-label="Storm motion knots" />
              <button onClick={applyMotion}>Apply</button>
              <em>{motionMessage || status?.stormMotion ? `${status?.stormMotion?.directionDegrees ?? motionDir} deg at ${status?.stormMotion?.speedKnots ?? motionSpeed} kt` : "SRV unavailable until set"}</em>
            </div>
          )}
          <div className="radar-help">
            Level II radial data is decoded on this tablet for REF, VEL, SRV, and CC. No laptop, Pi, or LAN radar worker is required. Level III products are deferred.
          </div>
        </aside>
      </div>
    </div>
  );
}
