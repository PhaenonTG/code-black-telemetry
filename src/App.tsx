import { useEffect, useMemo, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { StatusBar } from "@capacitor/status-bar";
import { EventsCard } from "./components/cards/EventsCard";
import { PowerCard } from "./components/cards/PowerCard";
import { SensorHealthCard } from "./components/cards/SensorHealthCard";
import { SystemCard } from "./components/cards/SystemCard";
import { TopBar } from "./components/layout/TopBar";
import { MissionStreamingPanel } from "./components/operations/MissionStreamingPanel";
import { PiEndpointPanel } from "./components/operations/PiEndpointPanel";
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
import { ChaserNetPanel } from "./components/situational/ChaserNetPanel";
import { SevereFlashOverlay } from "./components/SevereFlashOverlay";
import { SpotterOnboardingPrompt } from "./components/SpotterOnboardingPrompt";
import { WindCard } from "./components/situational/WindCard";
import { useAlertProducts } from "./hooks/useAlertProducts";
import { useSpcOutlook } from "./hooks/useSpcOutlook";
import { useNearbyPlaces } from "./hooks/useNearbyPlaces";
import { useNearbyPoiList } from "./hooks/useNearbyPoiList";
import { useSituationalData } from "./hooks/useSituationalData";
import { useSpotters } from "./hooks/useSpotters";
import { useStatus, useWeather, useWind } from "./hooks/useTelemetry";
import { useDeviceLabels } from "./hooks/useDeviceLabels";
import { useMissionSession } from "./hooks/useMissionSession";
import { useLocationTracking } from "./hooks/useLocationTracking";
import { sourceLabel } from "./services/location";
import { setCodeBlackSoundEnabled, SOUND_ENABLED_PREF_KEY, startCodeBlackSoundPlayer } from "./services/sound";
import { loadAppTheme, subscribeAppTheme, type AppThemeMode } from "./services/settings";
import { getSpotterAccount, hasSeenSpotterOnboarding, subscribeSpotterAccount, type SpotterAccount } from "./services/spotterAccount";
import { setTelemetryPaused } from "./services/telemetry";
import { publishVehicleDisplaySnapshot } from "./services/vehicleDisplay";
import { getLatestBreadcrumbPoint, recordBreadcrumbFromGps } from "./services/breadcrumbTrail";
import { recordMarkEvent, recordMarkEventFromBreadcrumb } from "./services/markEvents";
import { recoverMissionSession } from "./services/missionSession";
import { setDisplayCockpitMode, startDisplayController } from "./services/displayController";
import { createEgressContext, summarizeEgressReadiness } from "./services/egress";
import { locationTrackingService } from "./services/locationTracking";

type PageKey = "weather" | "operations" | "locate" | "alerts" | "report" | "settings" | "layers";
export type CockpitMode = "normal" | "chase";

const pages: Array<{ key: PageKey; label: string; path: string }> = [
  { key: "weather", label: "Weather", path: "/" },
  { key: "operations", label: "Operations", path: "/operations" },
  { key: "locate", label: "Locate", path: "/locate" },
  { key: "alerts", label: "Alerts", path: "/alerts" },
  { key: "report", label: "Report", path: "/report" },
  { key: "settings", label: "Settings", path: "/settings" },
  // Layers is intentionally a normal dock page now. Future layer/provider controls should land
  // there instead of adding dead buttons to the operational map surface.
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

function chaseStatusParts(locationTracking: ReturnType<typeof useLocationTracking>) {
  if (locationTracking.active) {
    const accuracy = locationTracking.latestObservation?.horizontalAccuracyM;
    return {
      tone: "active",
      tracking: "TRACKING ACTIVE",
      gps: Number.isFinite(accuracy) ? `GPS ${Math.round(accuracy!)} M` : "GPS GOOD",
    };
  }
  if (locationTracking.locationPermission === "denied") {
    return { tone: "degraded", tracking: "TRACKING DEGRADED", gps: "LOCATION LIMITED" };
  }
  if (locationTracking.state === "unavailable" || !locationTracking.backgroundCapable) {
    return { tone: "degraded", tracking: "BACKGROUND TRACKING OFF", gps: "GPS UNAVAILABLE" };
  }
  return { tone: "degraded", tracking: "TRACKING DEGRADED", gps: locationTracking.lastError ? "CHECK SETTINGS" : "GPS WAITING" };
}

function appPageSupportsOperationalActions(page: PageKey) {
  return page === "weather" || page === "locate" || page === "report";
}

function formatConnectionSummary(status: ReturnType<typeof useStatus> | undefined | null) {
  if (!status) return "NOT READY";
  const connection = status.connection;
  if (!connection?.isConfigured) return "NOT CONFIGURED";
  if (connection.connectionState === "CONNECTED") {
    const dataAge = connection.dataAgeMs && connection.dataAgeMs > 5_000 ? ` · DATA ${Math.round(connection.dataAgeMs / 1000)}s` : "";
    return `CONNECTED · ${connection.latencyMs ?? status.apiLatencyMs} ms${dataAge}`;
  }
  if (connection.connectionState === "STALE") {
    const age = connection.dataAgeMs == null ? "STALE" : `DATA ${Math.round(connection.dataAgeMs / 1000)}s OLD`;
    return `STALE · ${age}`;
  }
  if (connection.connectionState === "DEGRADED") return `DEGRADED · ${connection.lastErrorSummary || "CHECK STATUS"}`;
  if (connection.connectionState === "CONNECTING") return "CONNECTING";
  if (connection.retryAt) {
    const retrySeconds = Math.max(0, Math.round((connection.retryAt - Date.now()) / 1000));
    return `${connection.connectionState} · RETRY ${retrySeconds}s`;
  }
  return `${connection.connectionState}${connection.lastErrorSummary ? ` · ${connection.lastErrorSummary}` : ""}`;
}

export default function App() {
  const [page, setPage] = useState<PageKey>(() => pathToPage());
  const [cockpitMode, setCockpitMode] = useState<CockpitMode>("chase");
  const [appTheme, setAppTheme] = useState<AppThemeMode>("dark");
  const [markStatus, setMarkStatus] = useState("");
  const [escapeStatus, setEscapeStatus] = useState("");
  const [spotterAccount, setSpotterAccount] = useState<SpotterAccount | null>(() => getSpotterAccount());
  // Defaults true (prompt hidden) so there's no flash of the onboarding prompt before the async
  // Preferences read below resolves -- it only flips to false if the user genuinely hasn't seen it.
  const [spotterOnboardingSeen, setSpotterOnboardingSeen] = useState(true);
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const escapeTimerRef = useRef<number | null>(null);
  const markBusyRef = useRef(false);
  const nativeRecoveryAttemptRef = useRef<string | null>(null);
  const { gps, canonicalLocation, external, tabletPermission } = useSituationalData();
  const missionSession = useMissionSession();
  const deviceLabels = useDeviceLabels();
  const status = useStatus();
  const weather = useWeather();
  const wind = useWind();
  const lat = canonicalLocation.latitude;
  const lon = canonicalLocation.longitude;
  const headingDeg = canonicalLocation.headingDeg;
  const speedMph = canonicalLocation.speedMph;
  const accuracyM = canonicalLocation.accuracyM;
  // Rebuilding these as fresh object literals every render (App re-renders on every telemetry tick)
  // gave every consumer -- both live map instances, alert/outlook/nearby/spotter polling, all of
  // which sit in effect dependency arrays -- a "changed" gps reference every 1-2s even when the
  // vehicle hadn't actually moved, forcing camera/fetch effects to tear down and restart instead of
  // running on their intended schedule. Memoizing on the underlying primitives keeps the object
  // reference stable when the values themselves haven't.
  const gpsPoint = useMemo(() => (lat != null && lon != null ? { lat, lon } : null), [lat, lon]);
  const alertProducts = useAlertProducts(gpsPoint);
  const spcOutlooks = useSpcOutlook(gpsPoint);
  const nearby = useNearbyPlaces(gpsPoint);
  const poi = useNearbyPoiList(gpsPoint);
  const spotters = useSpotters(gpsPoint);
  const locationTracking = useLocationTracking();
  const chaseStatus = chaseStatusParts(locationTracking);
  const missionSessionId = missionSession?.id ?? null;
  const connectionSummary = formatConnectionSummary(status);
  const piState = status?.connection ? connectionSummary : "OFFLINE";
  const serviceState = status?.piOnline ? "VIA PI · LIVE" : status?.connection?.connectionState === "STALE" ? "VIA PI · STALE" : "VIA PI · OFFLINE";
  const coreState = connectionSummary;
  const showOperationalActions = appPageSupportsOperationalActions(page);
  const mapGps = useMemo(
    () => (gpsPoint ? { ...gpsPoint, headingDeg, speedMph, accuracyM } : null),
    [gpsPoint, headingDeg, speedMph, accuracyM],
  );

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
    const unsubscribe = subscribeAppTheme(setAppTheme);
    void loadAppTheme();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSpotterAccount(setSpotterAccount);
    void hasSeenSpotterOnboarding().then(setSpotterOnboardingSeen);
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
    setDisplayCockpitMode(mode);
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
    void publishVehicleDisplaySnapshot({ location: canonicalLocation, weather, wind, external });
  }, [canonicalLocation, weather, wind, external]);

  useEffect(() => {
    recordBreadcrumbFromGps(mapGps);
  }, [mapGps]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void locationTrackingService.syncPendingObservations();
    const interval = window.setInterval(() => {
      void locationTrackingService.syncPendingObservations();
    }, missionSessionId ? 15_000 : 45_000);
    const handleResume = () => {
      void locationTrackingService.syncPendingObservations();
    };
    window.addEventListener("codeblack:resume", handleResume);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("codeblack:resume", handleResume);
    };
  }, [missionSessionId]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || missionSession || !locationTracking.active || !locationTracking.sessionId) return;
    void recoverMissionSession(locationTracking.sessionId, locationTracking.startedAt || Date.now());
  }, [missionSession, locationTracking.active, locationTracking.sessionId, locationTracking.startedAt]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !missionSession || locationTracking.active || locationTracking.lastError) return;
    if (locationTracking.lastServiceEvent === "tracking_stopped" || locationTracking.lastServiceEvent === "tracking_stop_pending") return;
    if (nativeRecoveryAttemptRef.current === missionSession.id) return;
    nativeRecoveryAttemptRef.current = missionSession.id;
    void locationTrackingService.start({ session: missionSession, detailPreset: "balanced", persistent: true });
  }, [missionSession, locationTracking.active, locationTracking.lastError, locationTracking.lastServiceEvent]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void startDisplayController("chase").then((dispose) => {
      cleanup = dispose;
    });
    return () => {
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    setDisplayCockpitMode(cockpitMode);
  }, [cockpitMode]);

  useEffect(() => () => cancelEscapeHold(), []);

  const markCurrentPosition = async () => {
    if (markBusyRef.current) return;
    markBusyRef.current = true;
    await locationTrackingService.syncPendingObservations();
    const latestNativePoint = getLatestBreadcrumbPoint(missionSessionId);
    const nativeIsFresh = latestNativePoint && Date.now() - latestNativePoint.timestamp < 120_000;
    const result = locationTracking.active && nativeIsFresh
      ? await recordMarkEventFromBreadcrumb(latestNativePoint)
      : await recordMarkEvent(mapGps);
    if (!result.event) {
      setMarkStatus("MARK FAILED - NO GPS");
      window.setTimeout(() => setMarkStatus(""), 1800);
      window.setTimeout(() => { markBusyRef.current = false; }, 700);
      return;
    }
    setMarkStatus("MARK SAVED");
    window.setTimeout(() => setMarkStatus(""), 1800);
    window.setTimeout(() => { markBusyRef.current = false; }, 700);
  };

  const cancelEscapeHold = () => {
    if (escapeTimerRef.current == null) return;
    window.clearTimeout(escapeTimerRef.current);
    escapeTimerRef.current = null;
  };

  const armEscapeHold = () => {
    cancelEscapeHold();
    setEscapeStatus("HOLD TO ARM ESCAPE");
    escapeTimerRef.current = window.setTimeout(() => {
      escapeTimerRef.current = null;
      const context = createEgressContext({
        chaseSessionId: missionSessionId,
        currentPosition: mapGps ? {
          lat: mapGps.lat,
          lon: mapGps.lon,
          headingDeg: mapGps.headingDeg,
          speedMph: mapGps.speedMph ?? null,
        } : null,
      });
      const readiness = summarizeEgressReadiness(context);
      setEscapeStatus(readiness.state === "GOOD" ? "ESCAPE CONTEXT READY - ROUTING NOT ACTIVE" : readiness.message.toUpperCase());
      window.setTimeout(() => setEscapeStatus(""), 2600);
    }, 850);
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void StatusBar.hide();
    const listeners: Array<{ remove: () => Promise<void> }> = [];
    let pauseTimer: number | null = null;
    const clearPauseTimer = () => {
      if (pauseTimer != null) {
        window.clearTimeout(pauseTimer);
        pauseTimer = null;
      }
    };
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      clearPauseTimer();
      if (isActive) {
        setTelemetryPaused(false);
        window.dispatchEvent(new Event("codeblack:resume"));
        return;
      }
      // iOS reports isActive:false for any system alert taking focus, not just real
      // backgrounding -- including the Bluetooth pairing prompt itself. Pausing (which
      // disconnects BLE) immediately on that blip cancels the in-progress pairing handshake,
      // which iOS then re-prompts for, creating a continuous pairing-request loop. A brief
      // debounce lets transient dialogs resolve without tearing down the connection, while real
      // backgrounding (which stays inactive) still pauses shortly after.
      pauseTimer = window.setTimeout(() => {
        pauseTimer = null;
        setTelemetryPaused(true);
      }, 1500);
    }).then((listener) => listeners.push(listener));
    void CapApp.addListener("backButton", ({ canGoBack }) => {
      const openLayerPopover = document.querySelector(".atlas-layers-popover");
      if (openLayerPopover) {
        window.dispatchEvent(new Event("codeblack:close-map-popovers"));
        return;
      }
      const expandedRadar = document.querySelector(".radar-expanded--active");
      if (expandedRadar) {
        window.dispatchEvent(new Event("codeblack:close-radar"));
        return;
      }
      const closeButton = document.querySelector<HTMLButtonElement>(".modal-backdrop .icon-button, .pin-style-modal .icon-button, .color-field-modal .icon-button");
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
      clearPauseTimer();
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
    <div className={`app-shell app-shell--theme-${appTheme} app-shell--page-${page}${missionSession ? " app-shell--mission-active" : ""}`}>
      <SevereFlashOverlay />
      {showOperationalActions && (
        <>
          <button
            className="escape-button"
            type="button"
            onPointerDown={armEscapeHold}
            onPointerUp={cancelEscapeHold}
            onPointerLeave={cancelEscapeHold}
            onPointerCancel={cancelEscapeHold}
            aria-label="Hold to prepare escape context"
          >
            ESCAPE
          </button>
          <button className="mark-button" type="button" onClick={() => void markCurrentPosition()} aria-label="Mark current position">MARK</button>
        </>
      )}
      {markStatus && <div className="mark-toast" role="status">{markStatus}</div>}
      {escapeStatus && <div className="escape-toast" role="status">{escapeStatus}</div>}
      {!spotterAccount && !spotterOnboardingSeen && (
        <SpotterOnboardingPrompt onDismiss={() => setSpotterOnboardingSeen(true)} />
      )}
      <TopBar batteryLabel={deviceLabels.battery} />
      {missionSession && (
        <div className={`chase-status-strip chase-status-strip--${chaseStatus.tone}`} role="status">
          <span>CHASE ACTIVE</span>
          <span>{chaseStatus.tracking}</span>
          <span>{chaseStatus.gps}</span>
        </div>
      )}
      <main className="page-viewport" ref={pagerRef} aria-label="Code Black dashboard pages">
        <section className="page page--weather" aria-label="Situational Awareness">
          <div className="page-grid page-grid--weather">
            <LocationMotionPanel
              tabletPermission={tabletPermission}
              location={canonicalLocation}
              mode={cockpitMode}
              internalGpsLabel={deviceLabels.gps}
              gpsDeniedMessage={deviceLabels.deniedGps}
              gpsUnavailableMessage={deviceLabels.unavailableGps}
            />
            <WeatherObservationPanel external={external} mode={cockpitMode} />
            <WindCard external={external} mode={cockpitMode} />
            <AlertsPanel products={alertProducts.products} error={alertProducts.error} />
            <MapRadarPanel gps={mapGps} visible={page === "weather"} alerts={alertProducts.products} spotters={spotters.spotters} poiPlaces={poi.places} nearbyBest={nearby.places} compact allowExpand={false} />
            <NearbyPanel places={nearby.places} error={nearby.error} spotters={spotters.spotters} spottersError={spotters.error} />
            <SensorHealthCard className="phone-dashboard-only phone-dashboard-health" />
            <SystemCard className="phone-dashboard-only phone-dashboard-system" />
            <MissionStreamingPanel className="phone-dashboard-only phone-dashboard-streaming" />
          </div>
        </section>
        <section className="page page--operations" aria-label="Operations">
          <div className="page-grid page-grid--operations">
            <section className="ops-summary cb-panel">
              <div className="cb-panel__title"><span className="panel-glyph" aria-hidden="true" />Operational Mode</div>
              <div className="ops-mode">
                <strong>{status?.mode === "pi" ? "PI CONNECTED" : status?.mode === "tablet" ? deviceLabels.standaloneMode : "DEVELOPMENT SIMULATOR"}</strong>
                <span>PI {status?.connection?.connectionState ?? "OFFLINE"} | INTERNET {status?.internetOnline ? "AVAILABLE" : "UNKNOWN"}</span>
                <span className="ops-mode__hint">Cockpit display mode moved to Settings.</span>
              </div>
            </section>
            <SensorHealthCard className="ops-sensor-panel" />
            <SystemCard className="ops-system-panel" />
            <PowerCard className="ops-power-panel" />
            <MissionStreamingPanel />
            <PiEndpointPanel />
            <EventsCard className="events-ops" />
            <section className="cb-panel diagnostics-panel">
              <div className="cb-panel__title"><span className="panel-glyph" aria-hidden="true" />Diagnostics</div>
              <div className="diagnostic-grid">
                <span>PI API</span><strong>{piState}</strong>
                <span>Internet</span><strong>{status?.internetOnline ? "AVAILABLE" : "UNAVAILABLE"}</strong>
                <span>{deviceLabels.gps}</span><strong>{gps ? `${gps.source === "tablet" ? deviceLabels.gps.toUpperCase() : gps.source.toUpperCase()} · ${gps.accuracyM ? `${Math.round(gps.accuracyM)} m` : "ACTIVE"}` : "WAITING"}</strong>
                <span>UI Mode</span><strong>{cockpitMode.toUpperCase()}</strong>
                <span>Canonical GPS</span><strong>{canonicalLocation.validity} · {sourceLabel(canonicalLocation.source, deviceLabels.gps)}</strong>
                <span>Resolved Place</span><strong>{canonicalLocation.resolvedCity ? `${canonicalLocation.resolvedCity}, ${canonicalLocation.resolvedState ?? ""}` : canonicalLocation.fallbackReason}</strong>
                <span>Core / Pi</span><strong>{coreState}</strong>
                <span>Services</span><strong>{serviceState}</strong>
                <span>Logs</span><strong>RECENT EVENTS</strong>
              </div>
            </section>
          </div>
        </section>
        <section className="page page--locate" aria-label="Locate">
          <div className="page-grid page-grid--locate">
            <MapRadarPanel gps={mapGps} visible={page === "locate"} alerts={alertProducts.products} spotters={spotters.spotters} poiPlaces={poi.places} nearbyBest={nearby.places} />
          </div>
        </section>
        <section className="page page--alerts" aria-label="Alerts">
          <div className="page-grid page-grid--alerts">
            <AlertsFullPanel products={alertProducts.products} error={alertProducts.error} outlooks={spcOutlooks} onOpenReport={() => goToPage("report")} />
          </div>
        </section>
        <section className="page page--report" aria-label="Submit Report">
          <div className="page-grid page-grid--report">
            <ReportPage
              gps={gpsPoint}
              onOpenSettings={() => {
                goToPage("settings");
                focusPanel(".settings-spotter-panel");
              }}
            />
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
            diagnostics={{
              gpsSource: canonicalLocation.source,
              gpsSourceLabel: sourceLabel(canonicalLocation.source, deviceLabels.gps),
              gpsValidity: canonicalLocation.validity,
              gpsPermission: tabletPermission,
              serviceState,
            }}
            deviceLabels={deviceLabels}
          />
        </section>
        <section className="page page--layers" aria-label="Layer Configuration">
          <div className="page-grid page-grid--layers">
            <LayerConfigPage />
            <ChaserNetPanel />
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
