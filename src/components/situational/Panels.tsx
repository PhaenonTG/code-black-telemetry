import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Panel, MetricTile } from "./Panel";
import { SourceBadge } from "../ui/SourceBadge";
import { useWeather } from "../../hooks/useTelemetry";

// mapbox-gl (and everything under src/map/) is the single largest dependency in the bundle —
// deferring it to its own chunk keeps it out of the JS the app has to parse before first paint.
const AtlasMap = lazy(() => import("../../map/AtlasMap").then((mod) => ({ default: mod.AtlasMap })));
import { type AlertProduct, type ExternalObservation } from "../../services/situational";
import { type Spotter } from "../../services/spotters";
import { subscribeAlertFocus } from "../../services/mapFocusAlert";
import { sourceLabel, type CanonicalLocation } from "../../services/location";
import { cardinalFromDeg, compactAge, mbToInHg, valueText } from "../../services/telemetry/quality";
import { resolveWeatherWithFallback } from "../../services/telemetry/fallback";
import {
  ageText,
  getNearestRadarSites,
  getRadarFrames,
  getRadarStatus,
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

function localTime(value: string | number | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function LocationMotionPanel({ tabletPermission, location, mode }: { tabletPermission: string; location: CanonicalLocation; mode: CockpitMode }) {
  const valid = location.validity === "VALID" && location.latitude != null && location.longitude != null;
  const source = sourceLabel(location.source);
  const place = location.resolvedCity && location.resolvedState ? `${location.resolvedCity}, ${location.resolvedState}` : valid ? "CURRENT POSITION" : "GPS ACQUIRING";
  const county = location.resolvedCounty ?? (valid ? "LOCALITY RESOLVING" : "NO CURRENT GPS FIX");
  const fixValue = location.fixState === "FIX_3D" ? "3D FIX" : location.fixState === "FIX_2D" ? "2D FIX" : location.fixState.replace("_", " ");
  const fixHero = location.fixState === "FIX_3D" ? "3D" : location.fixState === "FIX_2D" ? "2D" : location.fixState.replace("_", " ");
  const altitudeValue = location.altitudeFt == null ? "--" : location.altitudeFt >= 1000 ? `${Math.round(location.altitudeFt / 1000)}K` : location.altitudeFt.toFixed(0);
  return (
    <Panel title="Location & Motion" className={`loc-panel cockpit-card cockpit-card--${mode}`}>
      <div className="loc-head cockpit-head">
        <div>
          <div className="loc-kicker">{mode === "chase" && valid ? "NEAR" : valid ? "LOCALITY" : "STATUS"}</div>
          <div className="loc-city">{place}</div>
          <div className="loc-county">{county}</div>
        </div>
        <SourceBadge state={location.freshness}>{source} · {location.timestamp ? compactAge(location.timestamp) : "NO FIX"}</SourceBadge>
      </div>
      <div className="cockpit-primary cockpit-primary--motion">
        <MetricTile label="Speed" value={valueText(location.speedMph, 1)} unit="mph" />
        <MetricTile label="Heading" value={location.headingCardinal || cardinalFromDeg(location.headingDeg)} unit={`${valueText(location.headingDeg, 0)} deg`} />
        {mode === "normal" && <MetricTile label="Elevation" value={altitudeValue} unit="ft" />}
        {mode === "chase" && <MetricTile label="GPS" value={fixHero} unit={location.accuracyM != null ? `+/-${Math.round(location.accuracyM)} m` : location.freshness} />}
      </div>
      <div className="loc-footer cockpit-footer">
        {mode === "normal" && <><div><span>Lat</span><strong>{valid ? location.latitude!.toFixed(5) : "--"}</strong></div><div><span>Lon</span><strong>{valid ? location.longitude!.toFixed(5) : "--"}</strong></div></>}
        <div><span>Fix</span><strong>{fixValue}</strong></div>
        {mode === "chase" && <div><span>Accuracy</span><strong>{location.accuracyM != null ? `+/-${Math.round(location.accuracyM)} M` : location.freshness}</strong></div>}
      </div>
      {tabletPermission === "denied" && <div className="cb-note cb-note--warn">Tablet GPS denied. Holding last valid source.</div>}
      {!valid && <div className="cb-note cb-note--warn">{location.fallbackReason}</div>}
    </Panel>
  );
}

export function WeatherObservationPanel({ external, mode }: { external: ExternalObservation | null; mode: CockpitMode }) {
  const wx = useWeather();
  const { temp, dew, humidity, pressure, spread, footerParts } = resolveWeatherWithFallback(wx, external);
  const pressureInHg = mbToInHg(pressure);
  const trend = wx?.pressureTrend ?? null;
  const trendGlyph = trend === "rising" ? "▲" : trend === "falling" ? "▼" : trend === "steady" ? "▬" : "";
  return (
    <Panel title={mode === "chase" ? "Conditions" : "Weather Observations"} className={`wx-panel cockpit-card cockpit-card--${mode}`}>
      <div className="cockpit-primary cockpit-primary--conditions cockpit-primary--conditions-full">
        {mode === "chase" ? (
          <>
            <MetricTile icon="T" label="Temp" value={valueText(temp, 0)} unit="deg F" accent="red" />
            <MetricTile icon="D" label="DP" value={valueText(dew, 0)} unit="deg F" accent="blue" />
            <MetricTile icon="S" label="Spread" value={valueText(spread, 0)} unit="deg" accent="amber" />
            <MetricTile
              icon="P"
              label="Pressure"
              value={
                <>
                  {valueText(pressureInHg, 1)}
                  {trendGlyph && <span className={`pressure-trend pressure-trend--${trend}`}>{trendGlyph}</span>}
                </>
              }
              unit="inHg"
              accent={trend === "rising" ? "green" : trend === "falling" ? "red" : "blue"}
            />
          </>
        ) : (
          <>
            <MetricTile icon="T" label="Temp" value={valueText(temp, 1)} unit="deg F" accent="red" />
            <MetricTile icon="D" label="Dew" value={valueText(dew, 0)} unit="deg F" accent="blue" />
            <MetricTile icon="%" label="RH" value={valueText(humidity, 0)} unit="%" accent="blue" />
            <MetricTile icon="P" label="Pressure" value={valueText(pressure, 0)} unit="mb" accent={wx?.pressureTrend === "rising" ? "green" : "blue"} />
          </>
        )}
      </div>
      <div className="conditions-strip">
        <span>RH <strong>{humidity == null ? "--" : `${Math.round(humidity)}%`}</strong></span>
        <span>RAIN <strong>{wx?.rainRateInHr == null ? "--" : `${wx.rainRateInHr.toFixed(2)} IN/HR`}</strong></span>
        {mode === "normal" && <span>TOTAL <strong>{wx?.rainTotalIn == null ? "--" : `${wx.rainTotalIn.toFixed(2)} IN`}</strong></span>}
        <span className="conditions-strip__source">{footerParts.length > 0 ? footerParts.join(" • ") : "SOURCE UNAVAILABLE"}</span>
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
        <button className="view-all-button" onClick={() => window.dispatchEvent(new Event("codeblack:view-all-alerts"))}>View All Alerts</button>
      </div>
      {selected && <ProductModal product={selected} onClose={() => setSelected(null)} />}
    </Panel>
  );
}

// Alerts is the one unified alerts destination now — this used to be split across two compact
// Weather-page cards (Alerts + Storm Threats). The Watch/MD/SPC-outlook summary row below is what
// Storm Threats used to show; the full pill list below that is what Alerts used to show, uncapped.
export function AlertsFullPanel({ products, error, onOpenReport }: { products: AlertProduct[]; error: string; onOpenReport: () => void }) {
  const [selected, setSelected] = useState<AlertProduct | null>(null);
  // Tapping a watch/warning/MD polygon on the map requests focus by id (mapFocusAlert.ts) and
  // separately fires the existing view-all-alerts navigation event -- this just needs to open the
  // matching product's modal once it lands here. If nothing matches (e.g. a watch polygon whose
  // area technically doesn't include this device's point-based alert fetch), it's a silent no-op
  // rather than a fabricated modal for a product this page never actually received.
  useEffect(() => {
    return subscribeAlertFocus((alertId) => {
      const match = products.find((product) => product.id === alertId);
      if (match) setSelected(match);
    });
  }, [products]);
  const watch = products.find((product) => product.type === "watch");
  const md = products.find((product) => product.type === "md");
  const warning = products.find((product) => product.type === "warning");
  return (
    <Panel title={`All Active Products ${products.length ? products.length : ""}`} className="alerts-full-panel" tone={products.some((p) => p.severity === "tornado" || p.severity === "pds") ? "red" : "spc"}>
      <div className="threat-list threat-list--summary">
        {watch ? (
          <button className="threat-card threat-card--watch" onClick={() => setSelected(watch)}>
            <span>{watch.title}</span>
            <strong>{watch.headline}</strong>
            <em>Expires {watch.expires || "--"}</em>
          </button>
        ) : (
          <div className="threat-card threat-card--watch threat-card--empty"><span>Watch Status</span><strong>No local watch</strong><em>NWS/SPC source</em></div>
        )}
        {md ? (
          <button className="threat-card threat-card--md" onClick={() => setSelected(md)}>
            <span>{md.title}</span>
            <strong>{md.insideText ?? md.headline}</strong>
            <em>Expires {md.expires || "--"}</em>
          </button>
        ) : (
          <div className="threat-card threat-card--md threat-card--empty"><span>Mesoscale Discussion</span><strong>No local MD</strong><em>Current location clear</em></div>
        )}
        {warning ? (
          <button className={`threat-card threat-card--${warning.severity}`} onClick={() => setSelected(warning)}>
            <span>{warning.title}</span>
            <strong>{warning.headline}</strong>
            <em>Expires {warning.expires || "--"}</em>
          </button>
        ) : (
          <div className="threat-card threat-card--risk threat-card--empty"><span>SPC Outlook</span><strong>No local SPC outlook</strong><em>Source: SPC</em></div>
        )}
      </div>
      <div className="alert-list alert-list--full">
        {products.length === 0 && <div className="calm-card">{error ? "ALERT DATA TEMPORARILY UNAVAILABLE" : "NO ACTIVE LOCATION-MATCHED PRODUCTS"}</div>}
        {products.map((product) => (
          <button key={product.id} className={`alert-pill alert-pill--${product.severity}`} onClick={() => setSelected(product)}>
            <i aria-hidden="true">{product.severity === "md" ? "MD" : product.severity === "watch" ? "W" : "!"}</i>
            <span>{product.title}</span>
            <strong>{product.headline}</strong>
            <em>{product.expires ? `Expires ${product.expires}` : product.source}</em>
          </button>
        ))}
      </div>
      <div className="alerts-full-panel__footer">
        <button className="settings-action" onClick={onOpenReport}>Submit Report</button>
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

function defaultRadarOpacity(product: RadarProduct) {
  if (product === "REF") return 0.74;
  if (product === "VEL" || product === "SRV") return 0.78;
  if (product === "CC") return 0.7;
  return 0.7;
}

type MapRadarPanelProps = {
  gps: { lat: number; lon: number; headingDeg: number | null; speedMph?: number | null; accuracyM?: number | null } | null;
  visible?: boolean;
  allowExpand?: boolean;
  productOverride?: RadarProduct;
  onProductOverrideChange?: (product: RadarProduct) => void;
  frameOverride?: RadarFrame | null;
  playbackContext?: { playing: boolean; frameIndex: number; frameCount: number };
  alerts?: AlertProduct[];
  spotters?: Spotter[];
};

export function MapRadarPanel(props: MapRadarPanelProps) {
  return <AtlasMapRadarPanel {...props} />;
}

function AtlasMapRadarPanel({
  gps,
  visible = true,
  allowExpand = true,
  productOverride,
  onProductOverrideChange,
  frameOverride,
  playbackContext,
  alerts = [],
  spotters = [],
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
          // Splash screen listens for this to know real radar data has actually loaded, not just
          // that the request resolved -- harmless no-op once the splash has unmounted its listener.
          if (orderedFrames[0]) window.dispatchEvent(new Event("codeblack:radar-first-frame"));
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
  // Belt-and-suspenders: don't trust loopSeries.liveEdge alone (it only means "newest frame we
  // have locally," which can still be hours old if the native cache never re-checked S3) — also
  // verify the frame's own absolute scan time is actually recent before ever labeling it LIVE.
  // 900s (15 min): NEXRAD volumes land roughly every 5-10 min, plus upload/download/decode
  // latency — this gives a realistic margin without ever calling truly stale data "LIVE".
  const frameAgeSeconds = activeFrame ? (Date.now() - new Date(activeFrame.time).getTime()) / 1000 : null;
  const liveState = loopSeries.liveEdge && frameAgeSeconds != null && frameAgeSeconds < 900 ? "LIVE" : "CACHED";
  // Owner: "no way of knowing if what I'm seeing is from 2 weeks ago or 2 mins ago" -- LIVE/CACHED
  // alone doesn't say how old "cached" actually is, so the scan age is always shown alongside it,
  // not just in the expanded radar view (which already had AGE via this same ageText helper).
  const freshnessLine = frameAgeSeconds != null ? `${liveState} - SCAN ${ageText(Math.round(frameAgeSeconds))} AGO` : liveState;
  const mapStatusLines = radarError
    ? [activeSite, radarError]
    : activeFrame
      ? [activeFrame.site.id, product, playbackContext?.playing ? `LOOP ${playbackContext.frameIndex + 1}/${playbackContext.frameCount}` : freshnessLine]
      : [activeSite, product, "LOADING"];

  return (
    <Panel title="Situational Map" className="map-panel map-panel--atlas">
      <div className="map-canvas atlas-host" data-map-gesture-zone="true">
        <Suspense fallback={<div className="atlas-map-loading">LOADING MAP ENGINE</div>}>
          <AtlasMap
            gps={gps}
            frame={radarLayerActive ? activeFrame : null}
            product={product}
            opacity={opacity}
            expanded={!allowExpand}
            rangeRings={rangeRings}
            onRangeRingsChange={setRangeRings}
            onOpenExpanded={allowExpand ? () => setExpanded(true) : undefined}
            statusLines={mapStatusLines}
            alerts={alerts}
            spotters={spotters}
          />
        </Suspense>
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
