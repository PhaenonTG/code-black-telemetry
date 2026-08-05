import { useEffect, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { StatusBar } from "@capacitor/status-bar";
import { EventsCard } from "./components/cards/EventsCard";
import { PowerCard } from "./components/cards/PowerCard";
import { SensorHealthCard } from "./components/cards/SensorHealthCard";
import { SystemCard } from "./components/cards/SystemCard";
import { TopBar } from "./components/layout/TopBar";
import { PiEndpointPanel } from "./components/operations/PiEndpointPanel";
import { RadarEnginePanel } from "./components/operations/RadarEndpointPanel";
import { SettingsPage } from "./components/settings/SettingsPage";
import { NearbyPanel } from "./components/situational/NearbyPanel";
import {
  AlertsFullPanel,
  AlertsPanel,
  LocationMotionPanel,
  MapRadarPanel,
  WeatherObservationPanel,
} from "./components/situational/Panels";
import { ReportPage } from "./components/situational/ReportPage";
import { LayerConfigPage } from "./components/situational/LayerConfigPage";
import { SevereFlashOverlay } from "./components/SevereFlashOverlay";
import { WindCard } from "./components/situational/WindCard";
import { useAlertProducts } from "./hooks/useAlertProducts";
import { useNearbyPlaces } from "./hooks/useNearbyPlaces";
import { useNearbyPoiList } from "./hooks/useNearbyPoiList";
import { useSituationalData } from "./hooks/useSituationalData";
import { useSpotters } from "./hooks/useSpotters";
import { useStatus } from "./hooks/useTelemetry";
import { setCodeBlackSoundEnabled, SOUND_ENABLED_PREF_KEY, startCodeBlackSoundPlayer } from "./services/sound";
import { loadNightVisionEnabled, subscribeNightVisionEnabled } from "./services/settings";
import { setTelemetryPaused } from "./services/telemetry";

type PageKey = "weather" | "operations" | "locate" | "alerts" | "report" | "settings" | "layers";
export type CockpitMode = "normal" | "chase";

const pages: Array<{ key: PageKey; label: string; path: string }> = [
  { key: "weather", label: "Weather", path: "/" },
  { key: "operations", label: "Operations", path: "/operations" },
  { key: "locate", label: "Locate", path: "/locate" },
  { key: "alerts", label: "Alerts", path: "/alerts" },
  { key: "report", label: "Report", path: "/report" },
  { key: "settings", label: "Settings", path: "/settings" },
  // Not one of the 6 bottom-dock buttons -- reached via the dock corner's "CODE BLACK" button
  // (see the bottom-dock nav below) or by swiping past Settings, same as any other page.
  { key: "layers", label: "Layers", path: "/layers" },
];
const PAGE_PREF_KEY = "codeblack.activePage";
const COCKPIT_MODE_KEY = "codeblack.cockpitMode";

function DockIcon({ type }: { type: "weather" | "operations" | "locate" | "alerts" | "report" | "settings" | "layers" }) {
  const common = { viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  if (type === "weather") return <svg {...common}><path d="M7.4 17.4h7.8a4.1 4.1 0 0 0 .7-8.1 5.7 5.7 0 0 0-11 1.6A3.4 3.4 0 0 0 7.4 17.4Z" /><path d="m13.3 12.2-2.1 4.1h3l-1.5 4.3 4.1-5.9h-3l1.6-2.5h-2.1Z" /></svg>;
  if (type === "operations") return <svg {...common}><path d="M5 4h14v10H5z" /><path d="M9 20h6M12 14v6" /></svg>;
  if (type === "locate") return <svg {...common}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>;
  if (type === "alerts") return <svg {...common}><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 8v5M12 17h.01" /></svg>;
  if (type === "report") return <svg {...common}><path d="M6 3h9l3 3v15H6z" /><path d="M9 8h7M9 12h7M9 16h4" /></svg>;
  if (type === "layers") return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v3M12 18.2v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.8 12h3M18.2 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>;
}

function pathToPage(): PageKey {
  const match = pages.find((item) => item.path === window.location.pathname);
  if (match) return match.key;
  return window.location.pathname === "/system" ? "operations" : "weather";
}

export default function App() {
  const [page, setPage] = useState<PageKey>(() => pathToPage());
  const [cockpitMode, setCockpitMode] = useState<CockpitMode>("chase");
  const [nightVisionEnabled, setNightVisionEnabled] = useState(false);
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const { gps, canonicalLocation, external, tabletPermission } = useSituationalData();
  const status = useStatus();
  const gpsPoint = canonicalLocation.latitude != null && canonicalLocation.longitude != null
    ? { lat: canonicalLocation.latitude, lon: canonicalLocation.longitude }
    : null;
  const alertProducts = useAlertProducts(gpsPoint);
  const nearby = useNearbyPlaces(gpsPoint);
  const poi = useNearbyPoiList(gpsPoint);
  const spotters = useSpotters(gpsPoint);
  const piState = status?.piOnline ? `ONLINE · ${status.apiLatencyMs} ms` : status?.updatedAt ? `OFFLINE · LAST CHECK ${new Date(status.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "OFFLINE";
  const serviceState = status?.piOnline ? "VIA PI · CHECK DASHBOARD" : "VIA PI · OFFLINE";
  const mapGps = gpsPoint ? { ...gpsPoint, headingDeg: canonicalLocation.headingDeg, speedMph: canonicalLocation.speedMph, accuracyM: canonicalLocation.accuracyM } : null;

  const goToPage = (next: PageKey) => {
    const index = pages.findIndex((item) => item.key === next);
    setPage(next);
    void Preferences.set({ key: PAGE_PREF_KEY, value: next });
    pagerRef.current?.scrollTo({ left: index * pagerRef.current.clientWidth, behavior: "smooth" });
    window.history.replaceState(null, "", pages[index].path);
  };

  const syncPageImmediately = (next: PageKey) => {
    const index = pages.findIndex((item) => item.key === next);
    setPage(next);
    pagerRef.current?.scrollTo({ left: index * pagerRef.current.clientWidth, behavior: "auto" });
    window.history.replaceState(null, "", pages[index].path);
  };

  useEffect(() => {
    const unsubscribe = subscribeNightVisionEnabled(setNightVisionEnabled);
    void loadNightVisionEnabled();
    return unsubscribe;
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => syncPageImmediately(pathToPage()));
    Preferences.get({ key: PAGE_PREF_KEY }).then(({ value }) => {
      if (value && pages.some((item) => item.key === value)) goToPage(value as PageKey);
    });
    Preferences.get({ key: COCKPIT_MODE_KEY }).then(({ value }) => {
      if (value === "normal" || value === "chase") setCockpitMode(value);
    });
    startCodeBlackSoundPlayer();
    Preferences.get({ key: SOUND_ENABLED_PREF_KEY }).then(({ value }) => {
      setCodeBlackSoundEnabled(value !== "false");
    });
  }, []);

  const changeCockpitMode = (mode: CockpitMode) => {
    setCockpitMode(mode);
    void Preferences.set({ key: COCKPIT_MODE_KEY, value: mode });
  };

  const focusPanel = (selector: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return;
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el.classList.add("cb-focus-pulse");
      window.setTimeout(() => el.classList.remove("cb-focus-pulse"), 1600);
    });
  };

  useEffect(() => {
    const pager = pagerRef.current;
    if (!pager) return;
    const handleScroll = () => {
      const nextIndex = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
      const next = pages[nextIndex]?.key;
      if (next && next !== page) {
        setPage(next);
        window.history.replaceState(null, "", pages[nextIndex].path);
      }
    };
    pager.addEventListener("scroll", handleScroll, { passive: true });
    return () => pager.removeEventListener("scroll", handleScroll);
  }, [page]);

  useEffect(() => {
    const handleViewAllAlerts = () => goToPage("alerts");
    window.addEventListener("codeblack:view-all-alerts", handleViewAllAlerts);
    return () => window.removeEventListener("codeblack:view-all-alerts", handleViewAllAlerts);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.hide();
    const listeners: Array<{ remove: () => Promise<void> }> = [];
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      setTelemetryPaused(!isActive);
      if (isActive) window.dispatchEvent(new Event("codeblack:resume"));
    }).then((listener) => listeners.push(listener));
    void CapApp.addListener("backButton", ({ canGoBack }) => {
      const expandedRadar = document.querySelector(".radar-expanded--active");
      if (expandedRadar) {
        window.dispatchEvent(new Event("codeblack:close-radar"));
        return;
      }
      const closeButton = document.querySelector<HTMLButtonElement>(".product-modal .icon-button");
      if (closeButton) {
        closeButton.click();
        return;
      }
      if (page !== "weather") {
        goToPage("weather");
        return;
      }
      if (canGoBack) window.history.back();
    }).then((listener) => listeners.push(listener));
    return () => {
      listeners.forEach((listener) => void listener.remove());
    };
  }, [page]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const index = pages.findIndex((item) => item.key === page);
      if (event.key === "ArrowRight" && index < pages.length - 1) goToPage(pages[index + 1].key);
      if (event.key === "ArrowLeft" && index > 0) goToPage(pages[index - 1].key);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [page]);

  useEffect(() => {
    const handleResize = () => goToPage(page);
    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, [page]);

  return (
    <div className={nightVisionEnabled ? "app-shell app-shell--night-vision" : "app-shell"}>
      <SevereFlashOverlay />
      <TopBar />
      <main className="page-viewport" ref={pagerRef} aria-label="Code Black dashboard pages">
        <section className="page page--weather" aria-label="Situational Awareness">
          <div className="page-grid page-grid--weather">
            <LocationMotionPanel tabletPermission={tabletPermission} location={canonicalLocation} mode={cockpitMode} />
            <WeatherObservationPanel external={external} mode={cockpitMode} />
            <WindCard external={external} mode={cockpitMode} />
            <AlertsPanel products={alertProducts.products} error={alertProducts.error} />
            <MapRadarPanel gps={mapGps} visible={page === "weather"} alerts={alertProducts.products} spotters={spotters.spotters} poiPlaces={poi.places} compact allowExpand={false} />
            <NearbyPanel places={nearby.places} error={nearby.error} spotters={spotters.spotters} spottersError={spotters.error} />
          </div>
        </section>
        <section className="page page--operations" aria-label="Operations">
          <div className="page-grid page-grid--operations">
            <section className="ops-summary cb-panel">
              <div className="cb-panel__title">Operational Mode</div>
              <div className="ops-mode">
                <strong>{status?.mode === "pi" ? "PI CONNECTED" : status?.mode === "tablet" ? "STANDALONE TABLET" : "DEVELOPMENT SIMULATOR"}</strong>
                <span>PI {status?.piOnline ? "ONLINE" : "OFFLINE"} | INTERNET {status?.internetOnline ? "AVAILABLE" : "UNKNOWN"}</span>
                <span className="ops-mode__hint">Cockpit display mode moved to Settings.</span>
              </div>
            </section>
            <SensorHealthCard />
            <SystemCard />
            <PowerCard />
            <RadarEnginePanel />
            <PiEndpointPanel />
            <EventsCard className="events-ops" />
            <section className="cb-panel diagnostics-panel">
              <div className="cb-panel__title">Diagnostics</div>
              <div className="diagnostic-grid">
                <span>PI API</span><strong>{piState}</strong>
                <span>Radar Engine</span><strong>ON DEVICE</strong>
                <span>Internet</span><strong>{status?.internetOnline ? "AVAILABLE" : "UNAVAILABLE"}</strong>
                <span>Native GPS</span><strong>{gps ? `${gps.source.toUpperCase()} · ${gps.accuracyM ? `${Math.round(gps.accuracyM)} m` : "ACTIVE"}` : "WAITING"}</strong>
                <span>UI Mode</span><strong>{cockpitMode.toUpperCase()}</strong>
                <span>Canonical GPS</span><strong>{canonicalLocation.validity} · {canonicalLocation.source.toUpperCase()}</strong>
                <span>Resolved Place</span><strong>{canonicalLocation.resolvedCity ? `${canonicalLocation.resolvedCity}, ${canonicalLocation.resolvedState ?? ""}` : canonicalLocation.fallbackReason}</strong>
                <span>Services</span><strong>{serviceState}</strong>
                <span>Logs</span><strong>RECENT EVENTS</strong>
              </div>
            </section>
          </div>
        </section>
        <section className="page page--locate" aria-label="Locate">
          <div className="page-grid page-grid--locate">
            <MapRadarPanel gps={mapGps} visible={page === "locate"} alerts={alertProducts.products} spotters={spotters.spotters} poiPlaces={poi.places} />
          </div>
        </section>
        <section className="page page--alerts" aria-label="Alerts">
          <div className="page-grid page-grid--alerts">
            <AlertsFullPanel products={alertProducts.products} error={alertProducts.error} onOpenReport={() => goToPage("report")} />
          </div>
        </section>
        <section className="page page--report" aria-label="Submit Report">
          <div className="page-grid page-grid--report">
            <ReportPage gps={gpsPoint} />
          </div>
        </section>
        <section className="page page--settings" aria-label="Settings">
          <SettingsPage
            cockpitMode={cockpitMode}
            onChangeCockpitMode={changeCockpitMode}
            onOpenPiConnection={() => {
              goToPage("operations");
              focusPanel(".pi-endpoint-panel");
            }}
          />
        </section>
        <section className="page page--layers" aria-label="Layer Configuration">
          <div className="page-grid page-grid--layers">
            <LayerConfigPage />
          </div>
        </section>
      </main>
      <div className="page-dots" aria-label="Page indicator">
        {pages.map((item) => <button key={item.key} aria-label={item.label} className={item.key === page ? "active" : ""} onClick={() => goToPage(item.key)} />)}
      </div>
      <nav className="bottom-dock" aria-label="Dashboard dock">
        <button className={page === "weather" ? "active" : ""} onClick={() => goToPage("weather")}><DockIcon type="weather" /><span>Weather</span></button>
        <button className={page === "operations" ? "active" : ""} onClick={() => goToPage("operations")}><DockIcon type="operations" /><span>Operations</span></button>
        <button className={page === "locate" ? "active" : ""} onClick={() => { goToPage("locate"); window.dispatchEvent(new Event("codeblack:center-map")); }}><DockIcon type="locate" /><span>Locate</span></button>
        <button className={page === "alerts" ? "active" : ""} onClick={() => goToPage("alerts")}><DockIcon type="alerts" /><span>Alerts</span></button>
        <button className={page === "report" ? "active" : ""} onClick={() => goToPage("report")}><DockIcon type="report" /><span>Report</span></button>
        <button className={page === "settings" ? "active" : ""} onClick={() => goToPage("settings")}><DockIcon type="settings" /><span>Settings</span></button>
        <button className={page === "layers" ? "active" : ""} aria-label="Map layer configuration" onClick={() => goToPage("layers")}><DockIcon type="layers" /><span>Layers</span></button>
      </nav>
    </div>
  );
}
