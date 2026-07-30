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
import { RadarEnginePanel } from "./components/operations/RadarEndpointPanel";
import {
  AlertsPanel,
  LocationMotionPanel,
  MapRadarPanel,
  StormThreatsPanel,
  WeatherObservationPanel,
  WindAwarenessPanel,
} from "./components/situational/Panels";
import { useAlertProducts } from "./hooks/useAlertProducts";
import { useSituationalData } from "./hooks/useSituationalData";
import { useStatus } from "./hooks/useTelemetry";
import { setTelemetryPaused } from "./services/telemetry";

type PageKey = "weather" | "operations";
export type CockpitMode = "normal" | "chase";

const pages: Array<{ key: PageKey; label: string; path: string }> = [
  { key: "weather", label: "Weather", path: "/" },
  { key: "operations", label: "Operations", path: "/operations" },
];
const PAGE_PREF_KEY = "codeblack.activePage";
const COCKPIT_MODE_KEY = "codeblack.cockpitMode";

function DockIcon({ type }: { type: "weather" | "operations" | "locate" | "alerts" | "settings" }) {
  const common = { viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  if (type === "weather") return <svg {...common}><path d="M7.4 17.4h7.8a4.1 4.1 0 0 0 .7-8.1 5.7 5.7 0 0 0-11 1.6A3.4 3.4 0 0 0 7.4 17.4Z" /><path d="m13.3 12.2-2.1 4.1h3l-1.5 4.3 4.1-5.9h-3l1.6-2.5h-2.1Z" /></svg>;
  if (type === "operations") return <svg {...common}><path d="M5 4h14v10H5z" /><path d="M9 20h6M12 14v6" /></svg>;
  if (type === "locate") return <svg {...common}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>;
  if (type === "alerts") return <svg {...common}><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 8v5M12 17h.01" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v3M12 18.2v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.8 12h3M18.2 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>;
}

function pathToPage(): PageKey {
  return window.location.pathname === "/operations" || window.location.pathname === "/system" || window.location.pathname === "/settings"
    ? "operations"
    : "weather";
}

export default function App() {
  const [page, setPage] = useState<PageKey>(() => pathToPage());
  const [cockpitMode, setCockpitMode] = useState<CockpitMode>("chase");
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const { gps, canonicalLocation, external, tabletPermission } = useSituationalData();
  const status = useStatus();
  const alertProducts = useAlertProducts(canonicalLocation.latitude != null && canonicalLocation.longitude != null ? { lat: canonicalLocation.latitude, lon: canonicalLocation.longitude } : null);
  const piState = status?.piOnline ? `ONLINE · ${status.apiLatencyMs} ms` : status?.updatedAt ? `OFFLINE · LAST CHECK ${new Date(status.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "OFFLINE";
  const serviceState = status?.piOnline ? "VIA PI · CHECK DASHBOARD" : "VIA PI · OFFLINE";

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
    requestAnimationFrame(() => syncPageImmediately(pathToPage()));
    Preferences.get({ key: PAGE_PREF_KEY }).then(({ value }) => {
      if (value === "weather" || value === "operations") goToPage(value);
    });
    Preferences.get({ key: COCKPIT_MODE_KEY }).then(({ value }) => {
      if (value === "normal" || value === "chase") setCockpitMode(value);
    });
  }, []);

  const changeCockpitMode = (mode: CockpitMode) => {
    setCockpitMode(mode);
    void Preferences.set({ key: COCKPIT_MODE_KEY, value: mode });
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
      if (page === "operations") {
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
      if (event.key === "ArrowRight") goToPage("operations");
      if (event.key === "ArrowLeft") goToPage("weather");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

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
    <div className="app-shell">
      <TopBar />
      <main className="page-viewport" ref={pagerRef} aria-label="Code Black dashboard pages">
        <section className="page page--weather" aria-label="Situational Awareness">
          <div className="page-grid page-grid--weather">
            <LocationMotionPanel tabletPermission={tabletPermission} location={canonicalLocation} mode={cockpitMode} />
            <WeatherObservationPanel external={external} mode={cockpitMode} />
            <WindAwarenessPanel external={external} mode={cockpitMode} />
            <AlertsPanel products={alertProducts.products} error={alertProducts.error} />
            <MapRadarPanel gps={canonicalLocation.latitude != null && canonicalLocation.longitude != null ? { lat: canonicalLocation.latitude, lon: canonicalLocation.longitude, headingDeg: canonicalLocation.headingDeg, speedMph: canonicalLocation.speedMph, accuracyM: canonicalLocation.accuracyM } : null} visible={page === "weather"} />
            <StormThreatsPanel products={alertProducts.products} />
          </div>
        </section>
        <section className="page page--operations" aria-label="Operations">
          <div className="page-grid page-grid--operations">
            <section className="ops-summary cb-panel">
              <div className="cb-panel__title">Operational Mode</div>
              <div className="ops-mode">
                <strong>{status?.mode === "pi" ? "PI CONNECTED" : status?.mode === "tablet" ? "STANDALONE TABLET" : "DEVELOPMENT SIMULATOR"}</strong>
                <span>PI {status?.piOnline ? "ONLINE" : "OFFLINE"} | INTERNET {status?.internetOnline ? "AVAILABLE" : "UNKNOWN"}</span>
                <div className="mode-toggle" aria-label="Cockpit information mode">
                  <button className={cockpitMode === "normal" ? "active" : ""} onClick={() => changeCockpitMode("normal")}>Normal</button>
                  <button className={cockpitMode === "chase" ? "active" : ""} onClick={() => changeCockpitMode("chase")}>Chase</button>
                </div>
              </div>
            </section>
            <SensorHealthCard />
            <SystemCard />
            <PowerCard />
            <RadarEnginePanel />
            <EventsCard className="events-ops" />
            <section className="cb-panel diagnostics-panel">
              <div className="cb-panel__title">Diagnostics</div>
              <div className="diagnostic-grid">
                <span>PI API</span><strong>{piState}</strong>
                <span>Radar Engine</span><strong>ON DEVICE</strong>
                <span>BLE</span><strong>WATCHING</strong>
                <span>Wi-Fi</span><strong>SYSTEM NETWORK</strong>
                <span>Starlink</span><strong>NOT CONFIGURED</strong>
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
      </main>
      <div className="page-dots" aria-label="Page indicator">
        {pages.map((item) => <button key={item.key} aria-label={item.label} className={item.key === page ? "active" : ""} onClick={() => goToPage(item.key)} />)}
      </div>
      <nav className="bottom-dock" aria-label="Dashboard dock">
        <button className={page === "weather" ? "active" : ""} onClick={() => goToPage("weather")}><DockIcon type="weather" /><span>WX</span><em>Weather</em></button>
        <button className={page === "operations" ? "active" : ""} onClick={() => goToPage("operations")}><DockIcon type="operations" /><span>OPS</span><em>Operations</em></button>
        <button onClick={() => window.dispatchEvent(new Event("codeblack:center-map"))}><DockIcon type="locate" /><span>LOC</span><em>Locate</em></button>
        <button onClick={() => document.querySelector(".alerts-panel")?.scrollIntoView({ block: "nearest", behavior: "smooth" })}><DockIcon type="alerts" /><span>Alerts</span><em>Products</em></button>
        <button onClick={() => goToPage("operations")}><DockIcon type="settings" /><span>SET</span><em>Settings</em></button>
        <div className="dock-signature" aria-hidden="true"><strong>CODE BLACK</strong><span>Weather. Data. Dominance.</span></div>
      </nav>
    </div>
  );
}
