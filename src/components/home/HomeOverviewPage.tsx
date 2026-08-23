import { useEffect, useState, type KeyboardEvent } from "react";
import { MapRadarPanel } from "../situational/Panels";
import type { AlertProduct, ExternalObservation } from "../../services/situational";
import type { CanonicalLocation } from "../../services/location";
import type { PiOperationalSummary } from "../../services/operationalStatus";
import { stateTone } from "../../services/operationalStatus";
import {
  DEFAULT_HOME_MODULES,
  loadHomeModules,
  saveHomeModules,
  subscribeHomeModules,
  type HomeModuleConfig,
  type HomeModuleKey,
  type HomeModuleSize,
} from "../../services/settings";
import type { AtlasGpsPoint } from "../../map/types";
import type { Spotter } from "../../services/spotters";
import type { NearbyCategory, NearbyPlace } from "../../services/nearby";

type NavigateTarget = "map" | "weather" | "alerts" | "operations";

type HomeOverviewPageProps = {
  missionActive: boolean;
  chaseTrackingLabel: string;
  chaseGpsLabel: string;
  location: CanonicalLocation;
  external: ExternalObservation | null;
  alerts: AlertProduct[];
  alertError: string;
  opsStatus: PiOperationalSummary;
  overlayState: string;
  mapGps: AtlasGpsPoint | null;
  spotters: Spotter[];
  poiPlaces: NearbyPlace[];
  nearbyBest: Partial<Record<NearbyCategory, NearbyPlace>>;
  onNavigate: (target: NavigateTarget) => void;
};

const MODULE_LABELS: Record<HomeModuleKey, string> = {
  chase: "Chase / Field Status",
  radar: "Radar Preview",
  weather: "Weather Now",
  alerts: "Active Alerts",
  system: "Vehicle / System Health",
  location: "Location / Motion",
};

const MODULE_SIZE_LABELS: Record<HomeModuleSize, string> = {
  compact: "Compact",
  standard: "Standard",
  expanded: "Expanded",
};

const MODULE_SIZES: HomeModuleSize[] = ["compact", "standard", "expanded"];

function formatNumber(value: number | null | undefined, suffix = "", digits = 0) {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(digits)}${suffix}`;
}

function formatAge(timestamp: number | null | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return "NO DATA";
  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 30_000) return "LIVE";
  if (ageMs < 90_000) return `${Math.round(ageMs / 1000)}s`;
  if (ageMs < 90 * 60_000) return `${Math.round(ageMs / 60_000)}m`;
  return "STALE";
}

function severityLabel(products: AlertProduct[]) {
  const top = products[0];
  if (!top) return "NO ACTIVE ALERTS";
  return top.title || top.headline || "ACTIVE ALERT";
}

function moduleClass(module: HomeModuleConfig) {
  return `home-module home-module--${module.key} home-module--${module.size}`;
}

const MODULE_DESTINATION_LABEL: Record<HomeModuleKey, string> = {
  chase: "Operations",
  radar: "Map",
  weather: "Weather",
  alerts: "Alerts",
  system: "Operations",
  location: "Map",
};

export function HomeOverviewPage({
  missionActive,
  chaseTrackingLabel,
  chaseGpsLabel,
  location,
  external,
  alerts,
  alertError,
  opsStatus,
  overlayState,
  mapGps,
  spotters,
  poiPlaces,
  nearbyBest,
  onNavigate,
}: HomeOverviewPageProps) {
  const [modules, setModules] = useState<HomeModuleConfig[]>(DEFAULT_HOME_MODULES);
  const [customizing, setCustomizing] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeHomeModules(setModules);
    void loadHomeModules();
    return unsubscribe;
  }, []);

  const persistModules = (next: HomeModuleConfig[]) => {
    setModules(next);
    void saveHomeModules(next);
  };

  const updateModule = (key: HomeModuleKey, patch: Partial<HomeModuleConfig>) => {
    persistModules(modules.map((module) => module.key === key ? { ...module, ...patch } : module));
  };

  const moveModule = (key: HomeModuleKey, direction: -1 | 1) => {
    const index = modules.findIndex((module) => module.key === key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= modules.length) return;
    const next = [...modules];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    persistModules(next);
  };

  // The whole module is the navigation action (no more separate "Open X" button per module) --
  // disabled while customizing since the user is tapping modules to configure them, not to leave
  // the page. role="button"/tabIndex/onKeyDown make this keyboard-operable the same way a real
  // <button> would be; a <section> was kept (not a <button>) because the radar module nests a real
  // interactive map, and a <button> can never legally contain another interactive element.
  const moduleNavProps = (key: HomeModuleKey, target: NavigateTarget) =>
    customizing
      ? {}
      : {
          role: "button" as const,
          tabIndex: 0,
          "aria-label": `Open ${MODULE_DESTINATION_LABEL[key]}`,
          onClick: () => onNavigate(target),
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onNavigate(target);
            }
          },
        };

  const renderModule = (module: HomeModuleConfig) => {
    if (!module.enabled) return null;
    if (module.key === "chase") {
      return (
        <section key={module.key} className={moduleClass(module)} data-testid="home-module-chase" {...moduleNavProps("chase", "operations")}>
          <div className="home-module__head"><span>Chase</span><strong>{missionActive ? "ACTIVE" : "READY"}</strong><i className="home-module__chevron" aria-hidden="true" /></div>
          <div className="home-module__primary">{missionActive ? "Chase Mode Active" : "Field Status Ready"}</div>
          <div className="home-module__grid">
            <span>Tracking</span><b>{chaseTrackingLabel}</b>
            <span>GPS</span><b>{chaseGpsLabel}</b>
          </div>
        </section>
      );
    }
    if (module.key === "radar") {
      return (
        <section key={module.key} className={moduleClass(module)} data-testid="home-module-radar" {...moduleNavProps("radar", "map")}>
          <div className="home-module__head"><span>Radar</span><strong>MOSAIC</strong><i className="home-module__chevron" aria-hidden="true" /></div>
          {/* The embedded preview is a real, independently interactive map (pan/pinch/marker taps) --
              its own clicks are stopped from bubbling up so panning the preview doesn't also fire
              the module's navigate-to-Map action underneath it. */}
          <div className="home-module__map" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <MapRadarPanel gps={mapGps} compact visible={true} allowExpand={false} alerts={alerts} spotters={spotters} poiPlaces={poiPlaces} nearbyBest={nearbyBest} />
          </div>
        </section>
      );
    }
    if (module.key === "weather") {
      return (
        <section key={module.key} className={moduleClass(module)} data-testid="home-module-weather" {...moduleNavProps("weather", "weather")}>
          <div className="home-module__head"><span>Weather</span><strong>{external ? formatAge(external.updatedAt) : "UNAVAILABLE"}</strong><i className="home-module__chevron" aria-hidden="true" /></div>
        <div className="home-module__primary">{formatNumber(external?.tempF, "F")}</div>
          <div className="home-module__grid home-module__grid--metrics">
            <span>Wind</span><b>{formatNumber(external?.windSpeedMph, " mph")}</b>
            <span>Gust</span><b>{formatNumber(external?.windGustMph, " mph")}</b>
            <span>RH</span><b>{formatNumber(external?.humidity, "%")}</b>
            <span>Dew</span><b>{formatNumber(external?.dewpointF, "F")}</b>
          </div>
        </section>
      );
    }
    if (module.key === "alerts") {
      return (
        <section key={module.key} className={moduleClass(module)} data-testid="home-module-alerts" {...moduleNavProps("alerts", "alerts")}>
          <div className="home-module__head"><span>Alerts</span><strong>{alertError ? "UNAVAILABLE" : `${alerts.length}`}</strong><i className="home-module__chevron" aria-hidden="true" /></div>
          <div className="home-module__primary">{alertError ? "Alert Data Unavailable" : severityLabel(alerts)}</div>
          <p>{alertError || (alerts[0]?.headline ?? "No official active alerts at current position.")}</p>
        </section>
      );
    }
    if (module.key === "system") {
      const transportTone = stateTone(opsStatus.transport.state);
      const telemetryTone = stateTone(opsStatus.telemetry.state);
      return (
        <section key={module.key} className={moduleClass(module)} data-testid="home-module-system" {...moduleNavProps("system", "operations")}>
          <div className="home-module__head"><span>System</span><strong>{opsStatus.modeLabel}</strong><i className="home-module__chevron" aria-hidden="true" /></div>
          <div className="home-module__grid">
            <span>Core / Pi</span><b data-tone={transportTone}>{opsStatus.transport.label}</b>
            <span>Telemetry</span><b data-tone={telemetryTone}>{opsStatus.telemetry.label}</b>
            <span>Overlay</span><b>{overlayState.replace("-", " ").toUpperCase()}</b>
          </div>
        </section>
      );
    }
    return (
      <section key={module.key} className={moduleClass(module)} data-testid="home-module-location" {...moduleNavProps("location", "map")}>
        <div className="home-module__head"><span>Location</span><strong>{location.freshness}</strong><i className="home-module__chevron" aria-hidden="true" /></div>
        <div className="home-module__primary">{location.resolvedCity ? `${location.resolvedCity}, ${location.resolvedState ?? ""}` : location.fallbackReason}</div>
        <div className="home-module__grid">
          <span>Speed</span><b>{formatNumber(location.speedMph, " mph")}</b>
          <span>Heading</span><b>{location.headingDeg == null ? "--" : `${Math.round(location.headingDeg)} deg ${location.headingCardinal}`}</b>
          <span>Accuracy</span><b>{formatNumber(location.accuracyM, " m")}</b>
        </div>
      </section>
    );
  };

  return (
    <div className="page-grid page-grid--home">
      <header className="home-overview__header">
        <div>
          <span>Code Black OPS</span>
          <strong>Field Overview</strong>
        </div>
        <button type="button" data-testid="home-customize-toggle" onClick={() => setCustomizing((value) => !value)}>
          {customizing ? "Done" : "Customize Home"}
        </button>
      </header>
      {customizing && (
        <section className="home-customize" data-testid="home-customize-panel" aria-label="Customize Home">
          {modules.map((module, index) => (
            <div key={module.key} className="home-customize__row" data-testid={`home-customize-${module.key}`}>
              <div className="home-customize__move" aria-label={`${MODULE_LABELS[module.key]} order`}>
                <button type="button" disabled={index === 0} onClick={() => moveModule(module.key, -1)} aria-label={`Move ${MODULE_LABELS[module.key]} up`}>Up</button>
                <button type="button" disabled={index === modules.length - 1} onClick={() => moveModule(module.key, 1)} aria-label={`Move ${MODULE_LABELS[module.key]} down`}>Down</button>
              </div>
              <strong>{MODULE_LABELS[module.key]}</strong>
              <label>
                <input type="checkbox" checked={module.enabled} onChange={(event) => updateModule(module.key, { enabled: event.target.checked })} />
                ON
              </label>
              <select value={module.size} onChange={(event) => updateModule(module.key, { size: event.target.value as HomeModuleSize })} aria-label={`${MODULE_LABELS[module.key]} size`}>
                {MODULE_SIZES.map((size) => <option key={size} value={size}>{MODULE_SIZE_LABELS[size]}</option>)}
              </select>
            </div>
          ))}
        </section>
      )}
      <div className="home-module-list">
        {modules.map(renderModule)}
      </div>
    </div>
  );
}
