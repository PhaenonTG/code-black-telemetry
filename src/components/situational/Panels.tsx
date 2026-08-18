import { lazy, memo, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Panel, MetricTile } from "./Panel";
import { SourceBadge } from "../ui/SourceBadge";
import { useWeather } from "../../hooks/useTelemetry";
import { useCountdown } from "../../hooks/useCountdown";

// mapbox-gl (and everything under src/map/) is the single largest dependency in the bundle —
// deferring it to its own chunk keeps it out of the JS the app has to parse before first paint.
const AtlasMap = lazy(() => import("../../map/AtlasMap").then((mod) => ({ default: mod.AtlasMap })));
import { type AlertProduct, type ExternalObservation } from "../../services/situational";
import { type SpcDayOutlook } from "../../services/spcOutlook";
import { type Spotter } from "../../services/spotters";
import { type NearbyCategory, type NearbyPlace } from "../../services/nearby";
import { subscribeAlertFocus } from "../../services/mapFocusAlert";
import type { AtlasRangeRingMode } from "../../map/types";
import { sourceLabel, type CanonicalLocation } from "../../services/location";
import { cardinalFromDeg, compactAge, mbToInHg, valueText } from "../../services/telemetry/quality";
import { resolveWeatherWithFallback } from "../../services/telemetry/fallback";
import type { CockpitMode } from "../../App";

export function LocationMotionPanel({
  tabletPermission,
  location,
  mode,
  internalGpsLabel = "Internal GPS",
  gpsDeniedMessage = "Internal GPS denied. Holding last valid source.",
  gpsUnavailableMessage = "Internal GPS unavailable. Check location permission.",
}: {
  tabletPermission: string;
  location: CanonicalLocation;
  mode: CockpitMode;
  internalGpsLabel?: string;
  gpsDeniedMessage?: string;
  gpsUnavailableMessage?: string;
}) {
  const valid = location.validity === "VALID" && location.latitude != null && location.longitude != null;
  const source = sourceLabel(location.source, internalGpsLabel);
  const place = location.resolvedCity && location.resolvedState ? `${location.resolvedCity}, ${location.resolvedState}` : valid ? "CURRENT POSITION" : "NO GPS FIX";
  const county = location.resolvedCounty ?? (valid ? "LOCALITY RESOLVING" : "NO CURRENT GPS FIX");
  const fixValue = location.fixState === "FIX_3D" ? "3D FIX" : location.fixState === "FIX_2D" ? "2D FIX" : location.fixState.replace("_", " ");
  const fixHero = !valid ? "NO FIX" : location.fixState === "FIX_3D" ? "3D" : location.fixState === "FIX_2D" ? "2D" : location.fixState.replace("_", " ");
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
        {mode === "normal" && <><div><span>Lat</span><strong>{valid ? location.latitude!.toFixed(5) : "--"}</strong></div><div><span>Lon</span><strong>{valid ? location.longitude!.toFixed(5) : "--"}</strong></div><div><span>Fix</span><strong>{fixValue}</strong></div></>}
        {mode === "chase" && (
          <div className="loc-footer--chase">
            <span>{valid ? `${location.latitude!.toFixed(4)}, ${location.longitude!.toFixed(4)}` : "-- , --"}</span>
          </div>
        )}
      </div>
      {tabletPermission === "denied" && <div className="cb-note cb-note--warn">{gpsDeniedMessage}</div>}
      {(tabletPermission === "unsupported" || tabletPermission === "error") && <div className="cb-note cb-note--warn">{gpsUnavailableMessage}</div>}
      {tabletPermission === "searching" && !valid && <div className="cb-note">Waiting for {internalGpsLabel.toLowerCase()} fix.</div>}
      {!valid && <div className="cb-note cb-note--warn">{location.fallbackReason}</div>}
    </Panel>
  );
}

export function WeatherObservationPanel({ external, mode }: { external: ExternalObservation | null; mode: CockpitMode }) {
  const wx = useWeather();
  const { temp, dew, humidity, pressure, spread, footerParts, badgeState } = resolveWeatherWithFallback(wx, external);
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
                  {valueText(pressureInHg, 2)}
                  {trendGlyph && <span className={`pressure-trend pressure-trend--${trend}`}>{trendGlyph}</span>}
                </>
              }
              unit="inHg"
              accent={trend === "rising" ? "green" : trend === "falling" ? "red" : "blue"}
            />
          </>
        ) : (
          <>
            <MetricTile icon="T" label="Temp" value={valueText(temp, 0)} unit="deg F" accent="red" />
            <MetricTile icon="D" label="Dew" value={valueText(dew, 0)} unit="deg F" accent="blue" />
            <MetricTile icon="%" label="RH" value={valueText(humidity, 0)} unit="%" accent="blue" />
            <MetricTile icon="P" label="Pressure" value={valueText(pressure, 0)} unit="mb" accent={wx?.pressureTrend === "rising" ? "green" : "blue"} />
          </>
        )}
      </div>
      <div className="conditions-strip">
        {mode === "normal" && <span>TOTAL <strong>{wx?.rainTotalIn == null ? "--" : `${wx.rainTotalIn.toFixed(2)} IN`}</strong></span>}
        <SourceBadge state={badgeState} className="conditions-strip__source">
          {footerParts.length > 0 ? footerParts.join(" • ") : "SOURCE UNAVAILABLE"}
        </SourceBadge>
      </div>
    </Panel>
  );
}

// Extracted so useCountdown (a hook) can be called once per pill rather than a variable number of
// times inside a .map() in the parent -- calling a hook inside a loop whose length can change
// between renders (products.length) would violate rules-of-hooks; giving each pill its own
// component makes the hook call count fixed (exactly one) per component instance instead.
// showDescription is only ever true from AlertsFullPanel's list -- Page 1's compact AlertsPanel
// stays headline-only to preserve the "glance in 1-2 seconds" requirement stated elsewhere in this
// project's design docs, rather than showing full alert wording on an already-dense card.
function AlertPill({ product, onClick, showDescription = false }: { product: AlertProduct; onClick: () => void; showDescription?: boolean }) {
  const countdown = useCountdown(product.expires);
  return (
    <div className="alert-pill-group">
      <button className={`alert-pill alert-pill--${product.severity}`} onClick={onClick}>
        <i aria-hidden="true">{product.severity === "md" ? "MD" : product.severity === "watch" ? "W" : "!"}</i>
        <span>{product.title}</span>
        <strong>{product.headline}</strong>
        <em>{countdown || (product.expires ? `Expires ${product.expires}` : product.source)}</em>
      </button>
      {showDescription && product.description && <p className="alert-pill__description">{product.description}</p>}
    </div>
  );
}

export function AlertsPanel({ products, error }: { products: AlertProduct[]; error: string }) {
  const [selected, setSelected] = useState<AlertProduct | null>(null);
  return (
    <Panel title={`Active Alerts ${products.length ? products.length : ""}`} className="alerts-panel" tone={products.some((p) => p.severity === "tornado" || p.severity === "pds") ? "red" : "spc"}>
      <div className="alert-list">
        {products.length === 0 && <div className="calm-card">{error ? "ALERT DATA TEMPORARILY UNAVAILABLE" : "NO ACTIVE LOCATION-MATCHED PRODUCTS"}</div>}
        {products.slice(0, 3).map((product) => (
          <AlertPill key={product.id} product={product} onClick={() => setSelected(product)} />
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
export function AlertsFullPanel({ products, error, outlooks = [], onOpenReport }: { products: AlertProduct[]; error: string; outlooks?: SpcDayOutlook[]; onOpenReport: () => void }) {
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
  // Fixed 3 calls regardless of whether watch/md/warning are actually present this render -- safe
  // under rules-of-hooks (a constant count, unlike a hook called inside a variable-length .map()).
  // Falls back to an empty string (useCountdown itself returns "" for an empty expires) when a
  // slot is unfilled.
  const watchCountdown = useCountdown(watch?.expires ?? "");
  const mdCountdown = useCountdown(md?.expires ?? "");
  const warningCountdown = useCountdown(warning?.expires ?? "");
  return (
    <Panel title={`All Active Products ${products.length ? products.length : ""}`} className="alerts-full-panel" tone={products.some((p) => p.severity === "tornado" || p.severity === "pds") ? "red" : "spc"}>
      <div className="threat-list threat-list--summary">
        {watch ? (
          <button className="threat-card threat-card--watch" onClick={() => setSelected(watch)}>
            <span>{watch.title}</span>
            <strong>{watch.headline}</strong>
            <em>{watchCountdown || `Expires ${watch.expires || "--"}`}</em>
          </button>
        ) : (
          <div className="threat-card threat-card--watch threat-card--empty"><span>Watch Status</span><strong>No local watch</strong><em>NWS/SPC source</em></div>
        )}
        {md ? (
          <button className="threat-card threat-card--md" onClick={() => setSelected(md)}>
            <span>{md.title}</span>
            <strong>{md.insideText ?? md.headline}</strong>
            <em>{mdCountdown || `Expires ${md.expires || "--"}`}</em>
          </button>
        ) : (
          <div className="threat-card threat-card--md threat-card--empty"><span>Mesoscale Discussion</span><strong>No local MD</strong><em>Current location clear</em></div>
        )}
        {warning ? (
          <button className={`threat-card threat-card--${warning.severity}`} onClick={() => setSelected(warning)}>
            <span>{warning.title}</span>
            <strong>{warning.headline}</strong>
            <em>{warningCountdown || `Expires ${warning.expires || "--"}`}</em>
          </button>
        ) : (
          <div className="threat-card threat-card--risk threat-card--empty"><span>Local Warning</span><strong>No active warning</strong><em>NWS source</em></div>
        )}
      </div>
      <div className="spc-outlook-row">
        {[1, 2, 3].map((day) => {
          const outlook = outlooks.find((o) => o.day === day);
          const cat = outlook?.categorical ?? null;
          const torn = outlook?.tornado ?? null;
          return (
            <div key={day} className="spc-outlook-card" style={cat?.color ? { borderColor: cat.color, backgroundColor: `${cat.color}22` } : undefined}>
              <span>DAY {day}</span>
              <strong style={cat?.color ? { color: cat.color } : undefined}>{cat ? cat.labelLong || cat.label : outlooks.length ? "No Risk" : "--"}</strong>
              {torn && <em>{torn.labelLong || torn.label} Tornado</em>}
            </div>
          );
        })}
      </div>
      <div className="alert-list alert-list--full">
        {products.length === 0 && <div className="calm-card">{error ? "ALERT DATA TEMPORARILY UNAVAILABLE" : "NO ACTIVE LOCATION-MATCHED PRODUCTS"}</div>}
        {products.map((product) => (
          <AlertPill key={product.id} product={product} onClick={() => setSelected(product)} showDescription />
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
  const countdown = useCountdown(product.expires);
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
          <span>EXPIRES {product.expires || "--"}{countdown ? ` (${countdown})` : ""}</span>
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

type MapRadarPanelProps = {
  gps: { lat: number; lon: number; headingDeg: number | null; speedMph?: number | null; accuracyM?: number | null } | null;
  visible?: boolean;
  allowExpand?: boolean;
  alerts?: AlertProduct[];
  spotters?: Spotter[];
  poiPlaces?: NearbyPlace[];
  nearbyBest?: Partial<Record<NearbyCategory, NearbyPlace>>;
  compact?: boolean;
};

// Both the Weather-page compact card and the Locate-page full map go through here -- App.tsx
// re-renders on every telemetry tick, and without memo every one of those ticks would reconcile
// this (and the mapbox-gl instance underneath it) even on ticks where none of its own props
// actually changed. Default shallow prop comparison is correct here now that App.tsx memoizes
// gps/mapGps on the underlying primitives instead of rebuilding a fresh object every render.
export const MapRadarPanel = memo(function MapRadarPanel(props: MapRadarPanelProps) {
  return <AtlasMapRadarPanel {...props} />;
});

// Wide-area mosaic (NEXRAD N0Q composite reflectivity via Iowa Environmental Mesonet,
// AtlasMosaicLayer.ts) is the radar view everywhere now. It is plain HTTP raster tiles with zero
// native-plugin dependency, so it renders the same way on iOS, Android, and the web preview.
function AtlasMapRadarPanel({
  gps,
  visible = true,
  allowExpand = true,
  alerts = [],
  spotters = [],
  poiPlaces = [],
  nearbyBest = {},
  compact = false,
}: MapRadarPanelProps) {
  const [rangeRings, setRangeRings] = useState<"off" | "10" | "25" | "50" | "100">("off");
  const [expanded, setExpanded] = useState(false);
  const mapStatusLines = ["MOSAIC", "NEXRAD N0Q COMPOSITE", "LIVE"];

  return (
    <Panel title="Situational Map" className="map-panel map-panel--atlas">
      <div className="map-canvas atlas-host" data-map-gesture-zone="true">
        <Suspense fallback={<div className="atlas-map-loading">LOADING MAP ENGINE</div>}>
          <AtlasMap
            gps={gps}
            expanded={!allowExpand && !compact}
            active={visible}
            rangeRings={rangeRings}
            onRangeRingsChange={setRangeRings}
            onOpenExpanded={allowExpand ? () => setExpanded(true) : undefined}
            statusLines={mapStatusLines}
            alerts={alerts}
            spotters={spotters}
            poiPlaces={poiPlaces}
            nearbyBest={nearbyBest}
            controlsVariant={compact ? "compact" : "full"}
          />
        </Suspense>
      </div>
      {allowExpand && expanded && typeof document !== "undefined" && createPortal(
        <RadarExpandedView
          active={expanded}
          gps={gps}
          rangeRings={rangeRings}
          setRangeRings={setRangeRings}
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
  rangeRings,
  setRangeRings,
  onClose,
}: {
  active: boolean;
  gps: { lat: number; lon: number; headingDeg: number | null } | null;
  rangeRings: AtlasRangeRingMode;
  setRangeRings: (rings: AtlasRangeRingMode) => void;
  onClose: () => void;
}) {
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

  return (
    <div className={`modal-backdrop radar-expanded ${active ? "radar-expanded--active" : ""}`} role="dialog" aria-modal="true" aria-hidden={!active} aria-label="Expanded radar interrogation">
      <div className="radar-expanded__shell">
        <header className="radar-expanded__top">
          <button className="icon-button radar-expanded__close" onClick={onClose} aria-label="Close radar">X</button>
          <strong>Wide-Area Mosaic</strong>
          <span>NEXRAD N0Q Composite Reflectivity - CONUS</span>
          <em>LIVE</em>
        </header>
        <div className="radar-expanded__map">
          <MapRadarPanel gps={gps} visible allowExpand={false} />
          <div className="radar-expanded__overlay-note">National composite reflectivity, auto-refreshing every few minutes.</div>
        </div>
        <aside className="radar-expanded__controls">
          <div>
            <span>Range rings</span>
            {(["off", "10", "25", "50", "100"] as const).map((value) => <button key={value} className={rangeRings === value ? "active" : ""} onClick={() => setRangeRings(value)}>{value === "off" ? "Off" : `${value} nm`}</button>)}
          </div>
          <div className="radar-help">
            Situational awareness view: national composite reflectivity (NEXRAD N0Q via Iowa Environmental Mesonet), refreshed automatically -- no laptop, Pi, LAN radar worker, or native decoder required.
          </div>
        </aside>
      </div>
    </div>
  );
}
