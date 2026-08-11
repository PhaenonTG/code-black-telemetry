import { useEffect, useState } from "react";
import { App as CapApp, type AppInfo } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Panel } from "../situational/Panel";
import type { CockpitMode } from "../../App";
import {
  DEFAULT_CHASER_RADIUS_MILES,
  getBleCommandToken,
  loadBleCommandToken,
  loadChaserRadiusMiles,
  loadNightVisionEnabled,
  loadTeamMembers,
  loadVehicleMarkerStyle,
  saveBleCommandToken,
  saveChaserRadiusMiles,
  saveNightVisionEnabled,
  saveTeamMembers,
  saveTelemetryLinkEnabled,
  saveVehicleMarkerStyle,
  subscribeChaserRadiusMiles,
  subscribeNightVisionEnabled,
  subscribePiEndpoint,
  subscribeTeamMembers,
  subscribeTelemetryLinkEnabled,
  subscribeVehicleMarkerStyle,
  type TeamMember,
  type VehicleMarkerStyle,
} from "../../services/settings";
import { emitCodeBlackSound, setCodeBlackSoundEnabled, SOUND_ENABLED_PREF_KEY, subscribeCodeBlackSoundEnabled } from "../../services/sound";
import { clearSpotterAccount, loadSpotterAccount, spotterNetworkLogin, subscribeSpotterAccount, type SpotterAccount } from "../../services/spotterAccount";
import { bleTelemetryClient } from "../../services/telemetry/ble-client";
import { PinStyleField } from "../map/PinStyleEditor";

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

interface SettingsPageProps {
  cockpitMode: CockpitMode;
  onChangeCockpitMode: (mode: CockpitMode) => void;
  onOpenPiConnection: () => void;
}

export function SettingsPage({ cockpitMode, onChangeCockpitMode, onOpenPiConnection }: SettingsPageProps) {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [piEndpoint, setPiEndpoint] = useState("");
  const [telemetryLinkEnabled, setTelemetryLinkEnabled] = useState(true);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [spotterAccount, setSpotterAccount] = useState<SpotterAccount | null>(null);
  const [spotterUsername, setSpotterUsername] = useState("");
  const [spotterPassword, setSpotterPassword] = useState("");
  const [spotterBusy, setSpotterBusy] = useState(false);
  const [spotterError, setSpotterError] = useState("");
  const [chaserRadiusMiles, setChaserRadiusMiles] = useState(DEFAULT_CHASER_RADIUS_MILES);
  const [chaserRadiusInput, setChaserRadiusInput] = useState(String(DEFAULT_CHASER_RADIUS_MILES));
  const [chaserRadiusSaved, setChaserRadiusSaved] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberGroup, setNewMemberGroup] = useState("");
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [vehicleMarkerStyle, setVehicleMarkerStyle] = useState<VehicleMarkerStyle>({ color: "#ff2d35", shape: "circle", sizeScale: 1 });
  const [nightVisionEnabled, setNightVisionEnabled] = useState(false);
  const [bleTokenInput, setBleTokenInput] = useState("");
  const [bleTokenSaved, setBleTokenSaved] = useState(false);
  const [bleConnected, setBleConnected] = useState(false);
  const [lightingBusy, setLightingBusy] = useState(false);
  const [lightingResult, setLightingResult] = useState("");
  const [chaseBusy, setChaseBusy] = useState(false);
  const [chaseResult, setChaseResult] = useState("");

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
    const unsubscribe = subscribeSpotterAccount(setSpotterAccount);
    void loadSpotterAccount();
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
    const unsubscribe = subscribeNightVisionEnabled(setNightVisionEnabled);
    void loadNightVisionEnabled();
    return unsubscribe;
  }, []);

  useEffect(() => {
    void loadBleCommandToken().then((token) => {
      setBleTokenInput(token);
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

  const toggleNightVision = (enabled: boolean) => {
    void saveNightVisionEnabled(enabled);
  };

  const saveBleToken = async () => {
    await saveBleCommandToken(bleTokenInput);
    setBleTokenSaved(true);
    window.setTimeout(() => setBleTokenSaved(false), 1600);
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
            <strong>Night Vision</strong>
            <span>Dims display to deep red/black for night chases.</span>
          </div>
          <div className="mode-toggle" aria-label="Night vision mode">
            <button className={nightVisionEnabled ? "" : "active"} onClick={() => toggleNightVision(false)}>Off</button>
            <button className={nightVisionEnabled ? "active" : ""} onClick={() => toggleNightVision(true)}>On</button>
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
            <strong>Test Alert Sound</strong>
            <span>{soundEnabled ? "Same tone as a real alert." : "Enable audible alerts to test."}</span>
          </div>
          <button className="settings-action" disabled={!soundEnabled} onClick={() => emitCodeBlackSound("warning")}>Play Test</button>
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
            <span>{piEndpoint || "Not configured — running in standalone tablet mode."}</span>
          </div>
          <button className="settings-action" onClick={onOpenPiConnection}>Open</button>
        </div>
      </Panel>

      <Panel title="Spotter Network" className="settings-spotter-panel">
        {spotterAccount ? (
          <div className="settings-row">
            <div>
              <strong>Signed In</strong>
              <span>{spotterAccount.username} · {spotterAccount.canReport ? "Can submit reports" : "Reporting not enabled on this account"}</span>
            </div>
            <button className="settings-action" onClick={signOutSpotter}>Sign Out</button>
          </div>
        ) : (
          <>
            <div className="settings-row settings-row--stack">
              <div>
                <strong>Sign In</strong>
                <span>Powers Chasers + report submission. Stored on-device only.</span>
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
            <span>{appInfo ? `${appInfo.version} (build ${appInfo.build})` : "Web preview build"}</span>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Radar Engine</strong>
            <span>On-device NEXRAD Level II decode</span>
          </div>
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
            <span>Name must match Spotter Network. Group/phone/email optional, shown on pin tap.</span>
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
            <span>Shared secret from the Pi. Required for lighting commands.</span>
          </div>
        </div>
        <div className="settings-row settings-row--stack">
          <input
            className="settings-input"
            placeholder="Command token"
            type="password"
            autoCapitalize="none"
            autoCorrect="off"
            value={bleTokenInput}
            onChange={(event) => setBleTokenInput(event.target.value)}
          />
          <button className="settings-action" onClick={() => void saveBleToken()}>{bleTokenSaved ? "Saved" : "Save"}</button>
        </div>
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
            <strong>Session</strong>
            <span>Chasing vs. standby -- switches lighting.</span>
          </div>
          <div className="mode-toggle" aria-label="Chase session">
            <button disabled={chaseBusy || !bleConnected} onClick={() => void sendChaseCommand("end_chase_session")}>End</button>
            <button disabled={chaseBusy || !bleConnected} onClick={() => void sendChaseCommand("start_chase_session")}>Start</button>
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
