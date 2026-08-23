import { useEffect, useState } from "react";
import { App as CapApp, type AppInfo } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Panel } from "../situational/Panel";
import type { CockpitMode } from "../../App";
import {
  DEFAULT_CHASER_RADIUS_MILES,
  DEFAULT_CHASE_TRACKING_SETTINGS,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_REPORT_FEED_RADIUS_MILES,
  DEFAULT_REPORT_FEED_RETENTION_HOURS,
  clearBleCommandToken,
  getBleCommandToken,
  loadAppTheme,
  loadBleCommandToken,
  loadChaserRadiusMiles,
  loadClockMode,
  loadChaseTrackingSettings,
  loadDisplaySettings,
  getBleCommandTokenDiagnostic,
  loadReportFeedRadiusMiles,
  loadReportFeedRetentionHours,
  loadTeamMembers,
  loadVehicleMarkerStyle,
  saveAppTheme,
  saveBleCommandToken,
  saveChaserRadiusMiles,
  saveClockMode,
  saveChaseTrackingSettings,
  saveDisplaySettings,
  saveReportFeedRadiusMiles,
  saveReportFeedRetentionHours,
  saveTeamMembers,
  saveTelemetryLinkEnabled,
  saveVehicleMarkerStyle,
  subscribeAppTheme,
  subscribeChaserRadiusMiles,
  subscribeClockMode,
  subscribeChaseTrackingSettings,
  subscribeDisplaySettings,
  subscribePiEndpoint,
  subscribeReportFeedRadiusMiles,
  subscribeReportFeedRetentionHours,
  subscribeTeamMembers,
  subscribeTelemetryLinkEnabled,
  subscribeVehicleMarkerStyle,
  type TeamMember,
  type VehicleMarkerStyle,
  type AppThemeMode,
  type ClockMode,
  type ChaseTrackingSettings,
  type DisplaySettings,
  type DisplayWakeMode,
} from "../../services/settings";
import { credentialConfiguredLabel } from "../../services/credentialSecurity";
import { secureCredentialStore } from "../../services/secureCredentials";
import { emitCodeBlackSound, setCodeBlackSoundEnabled, SOUND_ENABLED_PREF_KEY, subscribeCodeBlackSoundEnabled, type CodeBlackSoundEvent } from "../../services/sound";
import { clearSpotterAccount, loadSpotterAccount, spotterNetworkLogin, subscribeSpotterAccount, type SpotterAccount } from "../../services/spotterAccount";
import { bleTelemetryClient } from "../../services/telemetry/ble-client";
import { PinStyleField } from "../map/PinStyleEditor";
import type { DeviceLabels } from "../../hooks/useDeviceLabels";
import { endMissionSession, startMissionSession } from "../../services/missionSession";
import { useMissionSession } from "../../hooks/useMissionSession";
import { useLocationTracking } from "../../hooks/useLocationTracking";
import { locationTrackingService } from "../../services/locationTracking";
import { getPlatformCapabilities } from "../../services/platformCapabilities";
import { useStatus, useTelemetry } from "../../hooks/useTelemetry";
import {
  DEFAULT_LIVE_OVERLAY_TELEMETRY_SETTINGS,
  clearLiveOverlayTelemetryToken,
  getLiveOverlayTelemetryCredentialDiagnostic,
  hasLiveOverlayTelemetryToken,
  loadLiveOverlayTelemetrySettings,
  saveLiveOverlayTelemetrySettings,
  saveLiveOverlayTelemetryToken,
  subscribeLiveOverlayTelemetrySettings,
  subscribeLiveOverlayTelemetryTokenConfigured,
  type LiveOverlayTelemetrySettings,
} from "../../services/liveOverlayTelemetry";
import { useLiveOverlayTelemetry } from "../../hooks/useLiveOverlayTelemetry";
import { formatOperationalAgeFromMs, overlayStateLabel, summarizePiOperationalStatus } from "../../services/operationalStatus";

// Mirrors lighting/api.py's PRESET_COLORS on the Pi -- same names, same swatches, so a preset here
// maps to exactly one accepted preset string server-side rather than sending raw RGB that could
// drift from what the Pi actually supports.
const LIGHTING_COLOR_PRESETS: Array<{ preset: string; label: string; swatch: string }> = [
  { preset: "code_black_red", label: "Code Black Red", swatch: "#ff0000" },
  { preset: "dim_red", label: "Dim Red", swatch: "#8c0000" },
  { preset: "amber", label: "Amber", swatch: "#ff9600" },
  { preset: "white", label: "White", swatch: "#ffffff" },
  { preset: "green", label: "Green", swatch: "#00b43c" },
  { preset: "blue", label: "Blue", swatch: "#0050ff" },
];
const LIGHTING_PROFILE_PRESETS: Array<{ profile: string; label: string }> = [
  { profile: "chase", label: "Chase" },
  { profile: "standby", label: "Standby" },
  { profile: "off", label: "Off" },
];

// Mirrors server.py's STORM_MODE_PROFILES exactly -- set_storm_mode REJECTS anything outside this
// set, so this list can't drift from what the Pi actually accepts without both sides breaking.
const STORM_MODE_PRESETS: Array<{ mode: string; label: string }> = [
  { mode: "tornado_watch", label: "Tornado Watch" },
  { mode: "severe_thunderstorm_warning", label: "Severe TStorm" },
  { mode: "flash_flood_warning", label: "Flash Flood" },
  { mode: "tornado_warning", label: "Tornado Warning" },
  { mode: "pds_tornado_warning", label: "PDS Tornado" },
];

const ALERT_SOUND_TESTS: Array<{ event: CodeBlackSoundEvent; label: string }> = [
  { event: "severe-warning", label: "Severe" },
  { event: "tornado-warning", label: "Tornado" },
  { event: "pds-warning", label: "PDS" },
];

const THEME_OPTIONS: Array<{ mode: AppThemeMode; label: string }> = [
  { mode: "dark", label: "Dark" },
  { mode: "light", label: "Light" },
  { mode: "night", label: "Night" },
  { mode: "system", label: "System" },
];

const CLOCK_OPTIONS: Array<{ mode: ClockMode; label: string }> = [
  { mode: "local", label: "Local" },
  { mode: "central", label: "Central" },
  { mode: "zulu", label: "Zulu" },
];

const WAKE_OPTIONS: Array<{ mode: DisplayWakeMode; label: string }> = [
  { mode: "normal", label: "Normal" },
  { mode: "keep-awake-dim", label: "Awake + Dim" },
  { mode: "keep-awake-bright", label: "Awake + Bright" },
];

const TRACKING_DETAIL_OPTIONS: Array<{ preset: ChaseTrackingSettings["detailPreset"]; label: string }> = [
  { preset: "battery-saver", label: "Saver" },
  { preset: "balanced", label: "Balanced" },
  { preset: "high-detail", label: "Detail" },
];

function trackingIssueLabel(error: string) {
  const lower = error.toLowerCase();
  if (lower.includes("permission")) return "location permission limited";
  if (lower.includes("gps") || lower.includes("location")) return "GPS unavailable";
  if (lower.includes("notification")) return "notification permission unavailable";
  if (lower.includes("platform") || lower.includes("native")) return "persistent tracking unavailable";
  return error;
}

function trackingStatusCopy(locationTracking: ReturnType<typeof useLocationTracking>) {
  if (!locationTracking.backgroundCapable) {
    return {
      detail: "Persistent background tracking is not available on this platform.",
      label: "UNAVAILABLE",
    };
  }
  if (locationTracking.locationPermission === "denied") {
    return {
      detail: "Persistent tracking degraded: location permission limited.",
      label: "NO LOCATION",
    };
  }
  if (locationTracking.active) {
    const permissionNote = locationTracking.notificationPermission === "denied" ? "notification permission unavailable" : "foreground/background ready";
    return {
      detail: `Persistent chase tracking active · ${locationTracking.pointCount} breadcrumbs · ${permissionNote}.`,
      label: "TRACKING ACTIVE",
    };
  }
  if (locationTracking.lastError) {
    return {
      detail: `Persistent tracking degraded: ${trackingIssueLabel(locationTracking.lastError)}.`,
      label: "DEGRADED",
    };
  }
  return {
    detail: "Starts with Chase Mode and stops when the chase ends.",
    label: locationTracking.state === "unavailable" ? "UNAVAILABLE" : "READY",
  };
}

interface SettingsPageProps {
  cockpitMode: CockpitMode;
  onChangeCockpitMode: (mode: CockpitMode) => void;
  onOpenPiConnection: () => void;
  diagnostics: {
    gpsSource: string;
    gpsSourceLabel: string;
    gpsValidity: string;
    gpsPermission: string;
    serviceState: string;
    overlayTelemetryState: string;
  };
  deviceLabels: DeviceLabels;
}

export function SettingsPage({ cockpitMode, onChangeCockpitMode, onOpenPiConnection, diagnostics, deviceLabels }: SettingsPageProps) {
  const missionSession = useMissionSession();
  const locationTracking = useLocationTracking();
  const telemetryStatus = useStatus();
  const telemetry = useTelemetry();
  const liveOverlayStatus = useLiveOverlayTelemetry();
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [piEndpoint, setPiEndpoint] = useState("");
  const [telemetryLinkEnabled, setTelemetryLinkEnabled] = useState(true);
  const [overlaySettings, setOverlaySettings] = useState<LiveOverlayTelemetrySettings>(DEFAULT_LIVE_OVERLAY_TELEMETRY_SETTINGS);
  const [overlayTokenInput, setOverlayTokenInput] = useState("");
  const [overlayTokenConfigured, setOverlayTokenConfigured] = useState(false);
  const [overlaySettingsSaved, setOverlaySettingsSaved] = useState(false);
  const [overlaySettingsError, setOverlaySettingsError] = useState("");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [spotterAccount, setSpotterAccount] = useState<SpotterAccount | null>(null);
  const [spotterUsername, setSpotterUsername] = useState("");
  const [spotterPassword, setSpotterPassword] = useState("");
  const [spotterBusy, setSpotterBusy] = useState(false);
  const [spotterError, setSpotterError] = useState("");
  const [credentialStorageLabel, setCredentialStorageLabel] = useState("UNKNOWN");
  const [credentialWarning, setCredentialWarning] = useState("");
  const [chaserRadiusMiles, setChaserRadiusMiles] = useState(DEFAULT_CHASER_RADIUS_MILES);
  const [chaserRadiusInput, setChaserRadiusInput] = useState(String(DEFAULT_CHASER_RADIUS_MILES));
  const [chaserRadiusSaved, setChaserRadiusSaved] = useState(false);
  const [reportFeedRadiusMiles, setReportFeedRadiusMiles] = useState(DEFAULT_REPORT_FEED_RADIUS_MILES);
  const [reportFeedRadiusInput, setReportFeedRadiusInput] = useState(String(DEFAULT_REPORT_FEED_RADIUS_MILES));
  const [reportFeedRetentionHours, setReportFeedRetentionHours] = useState(DEFAULT_REPORT_FEED_RETENTION_HOURS);
  const [reportFeedRetentionInput, setReportFeedRetentionInput] = useState(String(DEFAULT_REPORT_FEED_RETENTION_HOURS));
  const [reportFeedSaved, setReportFeedSaved] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberGroup, setNewMemberGroup] = useState("");
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [vehicleMarkerStyle, setVehicleMarkerStyle] = useState<VehicleMarkerStyle>({ color: "#ff2d35", shape: "circle", sizeScale: 1 });
  const [appTheme, setAppTheme] = useState<AppThemeMode>("dark");
  const [clockMode, setClockMode] = useState<ClockMode>("local");
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  const [chaseTrackingSettings, setChaseTrackingSettings] = useState<ChaseTrackingSettings>(DEFAULT_CHASE_TRACKING_SETTINGS);
  const [localChaseBusy, setLocalChaseBusy] = useState(false);
  const [bleTokenInput, setBleTokenInput] = useState("");
  const [bleTokenConfigured, setBleTokenConfigured] = useState(false);
  const [bleTokenSaved, setBleTokenSaved] = useState(false);
  const [bleTokenError, setBleTokenError] = useState("");
  const [bleConnected, setBleConnected] = useState(false);
  const [lightingBusy, setLightingBusy] = useState(false);
  const [lightingResult, setLightingResult] = useState("");
  const [chaseBusy, setChaseBusy] = useState(false);
  const [chaseResult, setChaseResult] = useState("");
  const platform = Capacitor.getPlatform();
  const platformCapabilities = getPlatformCapabilities();
  const buildTime = Number.isNaN(Date.parse(__BUILD_TIME__)) ? __BUILD_TIME__ : new Date(__BUILD_TIME__).toLocaleString();
  const trackingCopy = trackingStatusCopy(locationTracking);
  const connection = telemetryStatus?.connection;
  const opsStatus = summarizePiOperationalStatus(telemetry);

  useEffect(() => {
    const unsubscribe = subscribePiEndpoint(setPiEndpoint);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeTelemetryLinkEnabled(setTelemetryLinkEnabled);
    return () => {
      unsubscribe();
    };
  }, []);

  const toggleTelemetryLink = (enabled: boolean) => {
    void saveTelemetryLinkEnabled(enabled);
  };

  useEffect(() => {
    const unsubscribe = subscribeLiveOverlayTelemetrySettings(setOverlaySettings);
    const unsubscribeToken = subscribeLiveOverlayTelemetryTokenConfigured(setOverlayTokenConfigured);
    void loadLiveOverlayTelemetrySettings().then(() => {
      const diagnostic = getLiveOverlayTelemetryCredentialDiagnostic();
      if (diagnostic.migrationError || diagnostic.readError) setCredentialWarning(diagnostic.migrationError || diagnostic.readError);
    });
    void hasLiveOverlayTelemetryToken().then(setOverlayTokenConfigured).catch((error: unknown) => {
      setCredentialWarning(error instanceof Error ? error.message : "Credential status could not be read.");
      setOverlayTokenConfigured(false);
    });
    return () => {
      unsubscribe();
      unsubscribeToken();
    };
  }, []);

  const updateOverlaySettingsDraft = (patch: Partial<LiveOverlayTelemetrySettings>) => {
    setOverlaySettings((current) => ({ ...current, ...patch }));
    setOverlaySettingsSaved(false);
    setOverlaySettingsError("");
  };

  const saveOverlaySettings = async () => {
    try {
      const saved = await saveLiveOverlayTelemetrySettings(overlaySettings);
      if (overlayTokenInput.trim()) {
        await saveLiveOverlayTelemetryToken(overlayTokenInput);
        setOverlayTokenInput("");
      }
      setOverlaySettings(saved);
      setOverlaySettingsSaved(true);
      setOverlaySettingsError("");
      window.setTimeout(() => setOverlaySettingsSaved(false), 1600);
    } catch (error) {
      setOverlaySettingsError(error instanceof Error ? error.message : "Overlay telemetry settings could not be saved.");
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeSpotterAccount(setSpotterAccount);
    void loadSpotterAccount().catch((error: unknown) => {
      setCredentialWarning(error instanceof Error ? error.message : "Spotter Network credential status could not be read.");
    });
    const storageInfo = secureCredentialStore.getStorageInfo();
    setCredentialStorageLabel(storageInfo.securityLevel === "native-secure" ? storageInfo.provider : storageInfo.securityLevel.toUpperCase());
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeCodeBlackSoundEnabled(setSoundEnabled);
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeChaserRadiusMiles((miles) => {
      setChaserRadiusMiles(miles);
      setChaserRadiusInput(String(miles));
    });
    void loadChaserRadiusMiles();
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribeRadius = subscribeReportFeedRadiusMiles((miles) => {
      setReportFeedRadiusMiles(miles);
      setReportFeedRadiusInput(String(miles));
    });
    const unsubscribeRetention = subscribeReportFeedRetentionHours((hours) => {
      setReportFeedRetentionHours(hours);
      setReportFeedRetentionInput(String(hours));
    });
    void loadReportFeedRadiusMiles();
    void loadReportFeedRetentionHours();
    return () => {
      unsubscribeRadius();
      unsubscribeRetention();
    };
  }, []);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      void CapApp.getInfo().then(setAppInfo).catch(() => setAppInfo(null));
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeTeamMembers(setTeamMembers);
    void loadTeamMembers();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeVehicleMarkerStyle(setVehicleMarkerStyle);
    void loadVehicleMarkerStyle();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribeTheme = subscribeAppTheme(setAppTheme);
    const unsubscribeClock = subscribeClockMode(setClockMode);
    const unsubscribeDisplay = subscribeDisplaySettings(setDisplaySettings);
    const unsubscribeChaseTracking = subscribeChaseTrackingSettings(setChaseTrackingSettings);
    void loadAppTheme();
    void loadClockMode();
    void loadDisplaySettings();
    void loadChaseTrackingSettings();
    return () => {
      unsubscribeTheme();
      unsubscribeClock();
      unsubscribeDisplay();
      unsubscribeChaseTracking();
    };
  }, []);

  useEffect(() => {
    void loadBleCommandToken()
      .then((token) => {
        const diagnostic = getBleCommandTokenDiagnostic();
        if (diagnostic.migrationError || diagnostic.readError) setBleTokenError(diagnostic.migrationError || diagnostic.readError);
        setBleTokenConfigured(Boolean(token));
        setBleTokenInput("");
      })
      .catch((error: unknown) => {
        setBleTokenConfigured(false);
        setBleTokenError(error instanceof Error ? error.message : "Command token status could not be read.");
      });
  }, []);

  useEffect(() => {
    return bleTelemetryClient.subscribe((_payload, connected) => setBleConnected(connected));
  }, []);

  const toggleSound = (next: boolean) => {
    setCodeBlackSoundEnabled(next);
    void Preferences.set({ key: SOUND_ENABLED_PREF_KEY, value: String(next) });
  };

  const signInSpotter = async () => {
    setSpotterBusy(true);
    setSpotterError("");
    const result = await spotterNetworkLogin(spotterUsername.trim(), spotterPassword);
    setSpotterBusy(false);
    if (result.success) {
      setSpotterPassword("");
    } else {
      setSpotterError(result.error);
    }
  };

  const signOutSpotter = () => {
    void clearSpotterAccount();
    setSpotterUsername("");
    setSpotterPassword("");
    setSpotterError("");
  };

  const saveRadius = async () => {
    const parsed = Number(chaserRadiusInput);
    const saved = await saveChaserRadiusMiles(Number.isFinite(parsed) ? parsed : chaserRadiusMiles);
    setChaserRadiusInput(String(saved));
    setChaserRadiusSaved(true);
    window.setTimeout(() => setChaserRadiusSaved(false), 1600);
  };

  const saveReportFeed = async () => {
    const parsedRadius = Number(reportFeedRadiusInput);
    const parsedRetention = Number(reportFeedRetentionInput);
    const [savedRadius, savedRetention] = await Promise.all([
      saveReportFeedRadiusMiles(Number.isFinite(parsedRadius) ? parsedRadius : reportFeedRadiusMiles),
      saveReportFeedRetentionHours(Number.isFinite(parsedRetention) ? parsedRetention : reportFeedRetentionHours),
    ]);
    setReportFeedRadiusInput(String(savedRadius));
    setReportFeedRetentionInput(String(savedRetention));
    setReportFeedSaved(true);
    window.setTimeout(() => setReportFeedSaved(false), 1600);
  };

  const addTeamMember = () => {
    const name = newMemberName.trim();
    if (!name || teamMembers.some((member) => member.name === name)) return;
    const member: TeamMember = {
      id: `${name}-${Date.now()}`,
      name,
      group: newMemberGroup.trim(),
      phone: newMemberPhone.trim(),
      email: newMemberEmail.trim(),
    };
    void saveTeamMembers([...teamMembers, member]);
    setNewMemberName("");
    setNewMemberGroup("");
    setNewMemberPhone("");
    setNewMemberEmail("");
  };

  const removeTeamMember = (id: string) => {
    void saveTeamMembers(teamMembers.filter((member) => member.id !== id));
  };

  const updateDisplaySettings = (patch: Partial<DisplaySettings>) => {
    void saveDisplaySettings({ ...displaySettings, ...patch });
  };

  const updateChaseTrackingSettings = (patch: Partial<ChaseTrackingSettings>) => {
    void saveChaseTrackingSettings({ ...chaseTrackingSettings, ...patch });
  };

  const startLocalChase = async () => {
    setLocalChaseBusy(true);
    setChaseResult("");
    try {
      const session = await startMissionSession();
      const trackingStatus = await locationTrackingService.start({
        session,
        detailPreset: chaseTrackingSettings.detailPreset,
        persistent: chaseTrackingSettings.persistentTrackingEnabled,
      });
      setChaseResult(trackingStatus.active ? "Local chase started. Persistent chase tracking active." : `Local chase started. Persistent tracking degraded: ${trackingIssueLabel(trackingStatus.lastError || "persistent tracking unavailable")}.`);
    } catch (error) {
      setChaseResult(`Chase start failed: ${trackingIssueLabel(error instanceof Error ? error.message : "persistent tracking unavailable")}.`);
    } finally {
      setLocalChaseBusy(false);
    }
  };

  const endLocalChase = async () => {
    setLocalChaseBusy(true);
    setChaseResult("");
    try {
      const trackingStatus = await locationTrackingService.stop();
      await locationTrackingService.syncPendingObservations();
      await endMissionSession();
      setChaseResult(trackingStatus.active ? "Chase ended, but persistent tracking still reports active." : "Local chase ended. Persistent chase tracking stopped.");
    } catch (error) {
      await endMissionSession();
      setChaseResult(`Chase ended locally. Persistent tracking cleanup needs attention: ${trackingIssueLabel(error instanceof Error ? error.message : "persistent tracking cleanup unavailable")}.`);
    } finally {
      setLocalChaseBusy(false);
    }
  };

  const saveBleToken = async () => {
    setBleTokenError("");
    try {
      const savedToken = await saveBleCommandToken(bleTokenInput);
      setBleTokenConfigured(Boolean(savedToken));
      setBleTokenInput("");
      setBleTokenSaved(true);
      window.setTimeout(() => setBleTokenSaved(false), 1600);
    } catch (error) {
      setBleTokenSaved(false);
      setBleTokenError(error instanceof Error ? error.message : "Credential not saved.");
    }
  };

  const removeBleToken = async () => {
    setBleTokenError("");
    try {
      await clearBleCommandToken();
      setBleTokenInput("");
      setBleTokenConfigured(false);
      setBleTokenSaved(true);
      window.setTimeout(() => setBleTokenSaved(false), 1600);
    } catch (error) {
      setBleTokenError(error instanceof Error ? error.message : "Credential could not be removed.");
    }
  };

  const removeOverlayToken = async () => {
    await clearLiveOverlayTelemetryToken();
    setOverlayTokenInput("");
    setOverlayTokenConfigured(false);
    setOverlaySettingsSaved(true);
    window.setTimeout(() => setOverlaySettingsSaved(false), 1600);
  };

  const sendLighting = async (action: "power" | "brightness" | "color" | "profile", params: Record<string, unknown>) => {
    if (!getBleCommandToken()) {
      setLightingResult("Set the command token above first.");
      return;
    }
    setLightingBusy(true);
    setLightingResult("");
    try {
      const response = await bleTelemetryClient.sendCommand("set_lighting", { action, params });
      if (response.status === "OK") {
        const state = typeof response.state === "string" ? response.state : "";
        setLightingResult(state === "OFFLINE" ? "Sent — lamp not currently connected to the Pi." : `Sent — ${state || "ok"}.`);
      } else {
        setLightingResult(`Rejected: ${response.reason || response.status}`);
      }
    } catch (error) {
      setLightingResult(error instanceof Error ? error.message : "Command failed.");
    } finally {
      setLightingBusy(false);
    }
  };

  const sendChaseCommand = async (cmd: "start_chase_session" | "end_chase_session" | "set_storm_mode", extra: Record<string, unknown> = {}) => {
    if (!getBleCommandToken()) {
      setChaseResult("Set the command token below first.");
      return;
    }
    setChaseBusy(true);
    setChaseResult("");
    try {
      const response = await bleTelemetryClient.sendCommand(cmd, extra);
      if (response.status === "OK") {
        const profile = typeof response.active_profile === "string" ? response.active_profile : "";
        setChaseResult(profile ? `Sent — lighting now ${profile}.` : "Sent.");
      } else {
        setChaseResult(`Rejected: ${response.reason || response.status}`);
      }
    } catch (error) {
      setChaseResult(error instanceof Error ? error.message : "Command failed.");
    } finally {
      setChaseBusy(false);
    }
  };

  return (
    <div className="page-grid page-grid--settings">
      <div className="settings-light-panels">
      <Panel title="Display" className="settings-display-panel">
        <div className="settings-row">
          <div>
            <strong>Cockpit Mode</strong>
            <span>Chase = reduced fields for driving. Normal = full detail.</span>
          </div>
          <div className="mode-toggle" aria-label="Cockpit information mode">
            <button className={cockpitMode === "normal" ? "active" : ""} onClick={() => onChangeCockpitMode("normal")}>Normal</button>
            <button className={cockpitMode === "chase" ? "active" : ""} onClick={() => onChangeCockpitMode("chase")}>Chase</button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Theme</strong>
            <span>Dark is default. Night keeps black surfaces with restrained red accents.</span>
          </div>
          <div className="settings-segmented settings-segmented--four" aria-label="Theme">
            {THEME_OPTIONS.map(({ mode, label }) => (
              <button key={mode} className={appTheme === mode ? "active" : ""} onClick={() => void saveAppTheme(mode)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Clock</strong>
            <span>Local follows device timezone. Central and Zulu stay fixed.</span>
          </div>
          <div className="settings-segmented settings-segmented--three" aria-label="Clock mode">
            {CLOCK_OPTIONS.map(({ mode, label }) => (
              <button key={mode} className={clockMode === mode ? "active" : ""} onClick={() => void saveClockMode(mode)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Screen</strong>
            <span>Wake Lock is used when the platform supports it; device brightness is never overwritten permanently.</span>
          </div>
          <div className="settings-segmented settings-segmented--three" aria-label="Display wake behavior">
            {WAKE_OPTIONS.map(({ mode, label }) => (
              <button key={mode} className={displaySettings.wakeMode === mode ? "active" : ""} onClick={() => updateDisplaySettings({ wakeMode: mode })}>{label}</button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>OPS Brightness</strong>
            <span>{Math.round(displaySettings.opsBrightness * 100)}% in-app brightness when Awake + Bright is active.</span>
          </div>
          <input
            className="settings-slider"
            type="range"
            min={15}
            max={100}
            value={Math.round(displaySettings.opsBrightness * 100)}
            onChange={(event) => updateDisplaySettings({ opsBrightness: Number(event.target.value) / 100 })}
          />
        </div>
        <div className="settings-row">
          <div>
            <strong>Chase Auto Awake</strong>
            <span>Automatically keep the screen awake during Chase Mode.</span>
          </div>
          <div className="mode-toggle" aria-label="Auto keep-awake during Chase Mode">
            <button className={displaySettings.autoEnableDuringChase ? "" : "active"} onClick={() => updateDisplaySettings({ autoEnableDuringChase: false })}>Off</button>
            <button className={displaySettings.autoEnableDuringChase ? "active" : ""} onClick={() => updateDisplaySettings({ autoEnableDuringChase: true })}>On</button>
          </div>
        </div>
      </Panel>

      <Panel title="Alerts" className="settings-alerts-panel">
        <div className="settings-row">
          <div>
            <strong>Audible Alerts</strong>
            <span>Tone on new tornado/PDS alert for your location.</span>
          </div>
          <div className="mode-toggle" aria-label="Audible alerts">
            <button className={soundEnabled ? "" : "active"} onClick={() => toggleSound(false)}>Off</button>
            <button className={soundEnabled ? "active" : ""} onClick={() => toggleSound(true)}>On</button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Test Alert Tones</strong>
            <span>{soundEnabled ? "Severe, tornado, and PDS each use a distinct tone." : "Enable audible alerts to test."}</span>
          </div>
          <div className="settings-alert-tone-tests">
            {ALERT_SOUND_TESTS.map(({ event, label }) => (
              <button key={event} className="settings-action" disabled={!soundEnabled} onClick={() => emitCodeBlackSound(event)}>{label}</button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Pi Connection" className="settings-connection-panel">
        <div className="settings-row">
          <div>
            <strong>Pi / ESP Link</strong>
            <span>
              {telemetryLinkEnabled
                ? "On -- scanning for BLE and polling HTTP."
                : "Off -- not scanning or polling. Turn on once hardware is present."}
            </span>
          </div>
          <div className="mode-toggle" aria-label="Pi/ESP link">
            <button className={telemetryLinkEnabled ? "" : "active"} onClick={() => toggleTelemetryLink(false)}>Off</button>
            <button className={telemetryLinkEnabled ? "active" : ""} onClick={() => toggleTelemetryLink(true)}>On</button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>API Base</strong>
            <span>{piEndpoint || deviceLabels.standaloneNote}</span>
          </div>
          <button className="settings-action" onClick={onOpenPiConnection}>Open</button>
        </div>
      </Panel>

      <Panel title="Live Overlay Telemetry" className="settings-overlay-panel">
        <div className="settings-row">
          <div>
            <strong>Share Live Overlay Telemetry</strong>
            <span>Publishes latest chase position to CodeBlack-Core for OBS overlays only. Separate from Spotter Network.</span>
          </div>
          <div className="mode-toggle" aria-label="Live overlay telemetry sharing">
            <button className={overlaySettings.enabled ? "" : "active"} onClick={() => updateOverlaySettingsDraft({ enabled: false })}>Off</button>
            <button className={overlaySettings.enabled ? "active" : ""} onClick={() => updateOverlaySettingsDraft({ enabled: true })}>On</button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Overlay Link</strong>
            <span>{liveOverlayStatus.lastErrorSummary || liveOverlayStatus.lastReason || "Publishes only while Chase Mode is active."}</span>
          </div>
          <strong>{overlayStateLabel(liveOverlayStatus.state)}</strong>
        </div>
        <div className="settings-row settings-row--stack">
          <input
            className="settings-input"
            placeholder="CodeBlack-Core endpoint"
            autoCapitalize="none"
            autoCorrect="off"
            value={overlaySettings.coreEndpoint}
            onChange={(event) => updateOverlaySettingsDraft({ coreEndpoint: event.target.value })}
          />
          <input
            className="settings-input"
            placeholder="Station ID"
            autoCapitalize="characters"
            autoCorrect="off"
            value={overlaySettings.stationId}
            onChange={(event) => updateOverlaySettingsDraft({ stationId: event.target.value })}
          />
          <input
            className="settings-input"
            placeholder={overlayTokenConfigured ? "Replace station token" : "Station token"}
            type="password"
            autoCapitalize="none"
            autoCorrect="off"
            value={overlayTokenInput}
            onChange={(event) => {
              setOverlayTokenInput(event.target.value);
              setOverlaySettingsSaved(false);
              setOverlaySettingsError("");
            }}
          />
          <button className="settings-action" onClick={() => void saveOverlaySettings()}>{overlaySettingsSaved ? "Saved" : "Save"}</button>
          <button className="settings-action" disabled={!overlayTokenConfigured} onClick={() => void removeOverlayToken()}>Remove Token</button>
        </div>
        <div className="settings-row">
          <div>
            <strong>Station Token</strong>
            <span>{credentialConfiguredLabel(overlayTokenConfigured)} · {credentialStorageLabel}</span>
          </div>
        </div>
        {overlaySettingsError && <div className="cb-note cb-note--warn">{overlaySettingsError}</div>}
        {credentialWarning && <div className="cb-note cb-note--warn">{credentialWarning}</div>}
      </Panel>

      <Panel title="Spotter Network" className="settings-spotter-panel">
        {spotterAccount ? (
          <div className="settings-row">
            <div>
              <strong>Signed In</strong>
              <span>{spotterAccount.username} · {spotterAccount.canReport ? "Can submit reports" : "Reporting not enabled on this account"} · credential {credentialStorageLabel}</span>
            </div>
            <button className="settings-action" onClick={signOutSpotter}>Sign Out</button>
          </div>
        ) : (
          <>
            <div className="settings-row settings-row--stack">
              <div>
                <strong>Sign In</strong>
                <span>Powers Spotter Network pins + explicit report submission. Password is not redisplayed after save.</span>
              </div>
            </div>
            <div className="settings-row settings-row--stack">
              <input
                className="settings-input"
                placeholder="Username"
                autoCapitalize="none"
                autoCorrect="off"
                value={spotterUsername}
                onChange={(event) => setSpotterUsername(event.target.value)}
              />
              <input
                className="settings-input"
                placeholder="Password"
                type="password"
                value={spotterPassword}
                onChange={(event) => setSpotterPassword(event.target.value)}
              />
              <button
                className="settings-action"
                disabled={spotterBusy || !spotterUsername.trim() || !spotterPassword}
                onClick={() => void signInSpotter()}
              >
                {spotterBusy ? "Signing In..." : "Sign In"}
              </button>
            </div>
            {spotterError && <div className="cb-note cb-note--warn">{spotterError}</div>}
          </>
        )}
      </Panel>

      <Panel title="Nearby Chasers" className="settings-radius-panel">
        <div className="settings-row">
          <div>
            <strong>Search Radius</strong>
            <span>Chasers search radius, 5-500 mi.</span>
          </div>
          <div className="settings-radius-control">
            <input
              className="settings-input settings-input--radius"
              type="number"
              inputMode="numeric"
              min={5}
              max={500}
              value={chaserRadiusInput}
              onChange={(event) => setChaserRadiusInput(event.target.value)}
            />
            <span>mi</span>
            <button className="settings-action" onClick={() => void saveRadius()}>{chaserRadiusSaved ? "Saved" : "Save"}</button>
          </div>
        </div>
      </Panel>

      <Panel title="Report Feed" className="settings-report-feed-panel">
        <div className="settings-row">
          <div>
            <strong>Report Radius</strong>
            <span>NWS + Spotter Network reports, 5-500 mi.</span>
          </div>
          <div className="settings-radius-control">
            <input
              className="settings-input settings-input--radius"
              type="number"
              inputMode="numeric"
              min={5}
              max={500}
              value={reportFeedRadiusInput}
              onChange={(event) => setReportFeedRadiusInput(event.target.value)}
            />
            <span>mi</span>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Keep Reports</strong>
            <span>Clears feed entries older than 1-24 hr.</span>
          </div>
          <div className="settings-radius-control">
            <input
              className="settings-input settings-input--radius"
              type="number"
              inputMode="numeric"
              min={1}
              max={24}
              value={reportFeedRetentionInput}
              onChange={(event) => setReportFeedRetentionInput(event.target.value)}
            />
            <span>hr</span>
            <button className="settings-action" onClick={() => void saveReportFeed()}>{reportFeedSaved ? "Saved" : "Save"}</button>
          </div>
        </div>
      </Panel>

      <Panel title="Vehicle Marker" className="settings-pins-panel">
        <div className="settings-row">
          <div>
            <strong>Your Dot</strong>
            <span>Color/shape for your position on the map.</span>
          </div>
          <PinStyleField label="Vehicle Marker" style={vehicleMarkerStyle} onChange={(style) => void saveVehicleMarkerStyle({ ...vehicleMarkerStyle, ...style })} />
        </div>
      </Panel>

      <Panel title="About" className="settings-about-panel">
        <div className="settings-row">
          <div>
            <strong>Version</strong>
            <span>{appInfo ? `${appInfo.version} (build ${appInfo.build})` : `${__APP_VERSION__} web preview`}</span>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Radar View</strong>
            <span>Wide-area NEXRAD mosaic</span>
          </div>
        </div>
      </Panel>

      <Panel title="Diagnostics" className="settings-diagnostics-panel">
        <div className="diagnostic-grid settings-diagnostic-grid">
          <span>Platform</span><strong>{platform.toUpperCase()}</strong>
          <span>Build</span><strong>{__APP_VERSION__}</strong>
          <span>Commit</span><strong>{__BUILD_BRANCH__} / {__BUILD_COMMIT__}</strong>
          <span>Built</span><strong>{buildTime}</strong>
          <span>Native App</span><strong>{appInfo ? `${appInfo.version} (${appInfo.build})` : "WEB PREVIEW"}</strong>
          <span>GPS</span><strong>{diagnostics.gpsValidity.toUpperCase()} / {diagnostics.gpsSourceLabel}</strong>
          <span>GPS Permission</span><strong>{diagnostics.gpsPermission.toUpperCase()}</strong>
          <span>Sensor Services</span><strong>{opsStatus.services.label}</strong>
          <span>Telemetry Data</span><strong>{opsStatus.telemetry.label}</strong>
          <span>Overlay Telemetry</span><strong>{overlayStateLabel(diagnostics.overlayTelemetryState)}</strong>
          <span>Pi Endpoint</span><strong>{piEndpoint || "NOT SET"}</strong>
          <span>Pi Link</span><strong>{telemetryLinkEnabled ? "ON" : "OFF"}</strong>
          <span>Pi Transport</span><strong>{opsStatus.transport.label}</strong>
          <span>Pi Link Type</span><strong>{connection?.transport?.toUpperCase() ?? "UNKNOWN"}</strong>
          <span>Pi Last Success</span><strong>{connection?.lastSuccessfulResponseAt ? new Date(connection.lastSuccessfulResponseAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "NONE"}</strong>
          <span>Pi Data Age</span><strong>{connection?.dataAgeMs == null ? "NO DATA" : formatOperationalAgeFromMs(connection.dataAgeMs)}</strong>
          <span>Pi Retry</span><strong>{connection?.retryAt ? `${Math.max(0, Math.round((connection.retryAt - Date.now()) / 1000))}s` : "IDLE"}</strong>
          <span>Pi Error</span><strong>{connection?.lastErrorSummary || "NONE"}</strong>
          <span>BLE</span><strong>{bleConnected ? "CONNECTED" : "DISCONNECTED"}</strong>
          <span>Spotter</span><strong>{spotterAccount ? spotterAccount.username : "SIGNED OUT"}</strong>
        </div>
      </Panel>
      </div>

      {/* Teams, Chase Session, and Interior Lighting are the heaviest panels on this page (a
          4-field add form / a token input plus 3 separate button rows) -- sharing a fixed grid row
          with the 8 lighter panels above was never going to fit both without either shrinking the
          light panels below usability or clipping these. Giving this group the page's remaining
          height (after the light panels claim only what their own auto-sized content needs)
          instead of a hand-tuned fr-fraction is what actually made "no scrolling anywhere" hold for
          every panel, not just most of them. */}
      <div className="settings-heavy-panels">
      <Panel title="Teams" className="settings-team-panel">
        <div className="settings-row">
          <div>
            <strong>Team Members</strong>
            <span>Name must match Spotter Network. Group, phone, and email are optional and shown on pin tap.</span>
          </div>
        </div>
        <div className="settings-row settings-row--stack">
          <input
            className="settings-input"
            placeholder="Name or marker ID (required)"
            value={newMemberName}
            onChange={(event) => setNewMemberName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addTeamMember(); }}
          />
          <input
            className="settings-input"
            placeholder="Group (e.g. Alpha, Chase Vehicle 2)"
            value={newMemberGroup}
            onChange={(event) => setNewMemberGroup(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addTeamMember(); }}
          />
          <input
            className="settings-input"
            placeholder="Phone"
            type="tel"
            value={newMemberPhone}
            onChange={(event) => setNewMemberPhone(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addTeamMember(); }}
          />
          <input
            className="settings-input"
            placeholder="Email"
            type="email"
            value={newMemberEmail}
            onChange={(event) => setNewMemberEmail(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addTeamMember(); }}
          />
          <button className="settings-action" disabled={!newMemberName.trim()} onClick={addTeamMember}>Add</button>
        </div>
        {teamMembers.length > 0 && (
          <div className="settings-roster-list">
            {teamMembers.map((member) => (
              <div key={member.id} className="settings-roster-chip" title={[member.phone, member.email].filter(Boolean).join(" · ") || undefined}>
                <span>{member.name}{member.group ? ` (${member.group})` : ""}</span>
                <button type="button" aria-label={`Remove ${member.name}`} onClick={() => removeTeamMember(member.id)}>×</button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Interior Lighting" className="settings-lighting-panel">
        <div className="settings-row">
          <div>
            <strong>Command Token</strong>
            <span>Shared secret from the Pi. Required for lighting commands. {credentialConfiguredLabel(bleTokenConfigured)} · {credentialStorageLabel}</span>
          </div>
        </div>
        <div className="settings-row settings-row--stack">
          <input
            className="settings-input"
            placeholder={bleTokenConfigured ? "Replace command token" : "Command token"}
            type="password"
            autoCapitalize="none"
            autoCorrect="off"
            value={bleTokenInput}
            onChange={(event) => setBleTokenInput(event.target.value)}
          />
          <button className="settings-action" disabled={!bleTokenInput.trim()} onClick={() => void saveBleToken()}>{bleTokenSaved ? "Saved" : "Save"}</button>
          <button className="settings-action" disabled={!bleTokenConfigured} onClick={() => void removeBleToken()}>Remove Token</button>
        </div>
        {bleTokenError && <div className="cb-note cb-note--warn">{bleTokenError}</div>}
        <div className="settings-row">
          <div>
            <strong>Govee H7090</strong>
            <span>{bleConnected ? "Pi link connected." : "Not connected -- commands will fail."}</span>
          </div>
          <div className="mode-toggle" aria-label="Lighting power">
            <button disabled={lightingBusy || !bleConnected} onClick={() => void sendLighting("power", { power: false })}>Off</button>
            <button disabled={lightingBusy || !bleConnected} onClick={() => void sendLighting("power", { power: true })}>On</button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Profile</strong>
          </div>
          <div className="settings-lighting-profiles" aria-label="Lighting profile">
            {LIGHTING_PROFILE_PRESETS.map(({ profile, label }) => (
              <button key={profile} type="button" disabled={lightingBusy || !bleConnected} onClick={() => void sendLighting("profile", { profile })}>{label}</button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Color</strong>
          </div>
          <div className="settings-lighting-swatches" aria-label="Lighting color preset">
            {LIGHTING_COLOR_PRESETS.map(({ preset, label, swatch }) => (
              <button
                key={preset}
                type="button"
                aria-label={label}
                title={label}
                disabled={lightingBusy || !bleConnected}
                style={{ backgroundColor: swatch }}
                onClick={() => void sendLighting("color", { preset })}
              />
            ))}
          </div>
        </div>
        {lightingResult && <div className="cb-note">{lightingResult}</div>}
      </Panel>

      <Panel title="Chase Session" className="settings-chase-panel">
        <div className="settings-row">
          <div>
            <strong>Persistent Tracking</strong>
            <span>{platformCapabilities.nativePersistentLocation ? "Records chase breadcrumbs while OPS is backgrounded or locked." : "Persistent background tracking is not configured on this platform."}</span>
          </div>
          <div className="mode-toggle" aria-label="Persistent chase tracking">
            <button className={chaseTrackingSettings.persistentTrackingEnabled ? "" : "active"} disabled={!platformCapabilities.nativePersistentLocation} onClick={() => updateChaseTrackingSettings({ persistentTrackingEnabled: false })}>Off</button>
            <button className={chaseTrackingSettings.persistentTrackingEnabled ? "active" : ""} disabled={!platformCapabilities.nativePersistentLocation} onClick={() => updateChaseTrackingSettings({ persistentTrackingEnabled: true })}>On</button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Tracking Detail</strong>
            <span>Stores cross-platform intent; each platform translates it to native sampling.</span>
          </div>
          <div className="settings-segmented settings-segmented--three" aria-label="Tracking detail">
            {TRACKING_DETAIL_OPTIONS.map(({ preset, label }) => (
              <button key={preset} className={chaseTrackingSettings.detailPreset === preset ? "active" : ""} disabled={!platformCapabilities.nativePersistentLocation} onClick={() => updateChaseTrackingSettings({ detailPreset: preset })}>{label}</button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Session</strong>
            <span>{missionSession ? `Active since ${new Date(missionSession.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Creates a local operational boundary for breadcrumbs, marks, reports, and future sync."}</span>
          </div>
          <div className="mode-toggle" aria-label="Chase session">
            <button className={!missionSession ? "" : "active"} disabled={localChaseBusy || !missionSession} onClick={() => void endLocalChase()}>End</button>
            <button className={missionSession ? "active" : ""} disabled={localChaseBusy || Boolean(missionSession)} onClick={() => void startLocalChase()}>Start</button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Tracking Status</strong>
            <span>{trackingCopy.detail}</span>
          </div>
          <strong>{trackingCopy.label}</strong>
        </div>
        <div className="settings-row">
          <div>
            <strong>Pi Session Command</strong>
            <span>{bleConnected ? "Optional hardware command path for vehicle lighting/backend state." : "BLE not connected; local session still works."}</span>
          </div>
          <div className="mode-toggle" aria-label="Pi chase session command">
            <button disabled={chaseBusy || !bleConnected} onClick={() => void sendChaseCommand("end_chase_session")}>Pi End</button>
            <button disabled={chaseBusy || !bleConnected} onClick={() => void sendChaseCommand("start_chase_session")}>Pi Start</button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Storm Mode</strong>
          </div>
        </div>
        <div className="settings-lighting-profiles" aria-label="Storm mode">
          {STORM_MODE_PRESETS.map(({ mode, label }) => (
            <button key={mode} type="button" disabled={chaseBusy || !bleConnected} onClick={() => void sendChaseCommand("set_storm_mode", { mode })}>{label}</button>
          ))}
        </div>
        {chaseResult && <div className="cb-note">{chaseResult}</div>}
      </Panel>
      </div>
    </div>
  );
}
