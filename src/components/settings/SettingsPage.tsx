import { useEffect, useState } from "react";
import { App as CapApp, type AppInfo } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Panel } from "../situational/Panel";
import type { CockpitMode } from "../../App";
import { DEFAULT_CHASER_RADIUS_MILES, loadChaserRadiusMiles, saveChaserRadiusMiles, subscribeChaserRadiusMiles, subscribePiEndpoint } from "../../services/settings";
import { emitCodeBlackSound, setCodeBlackSoundEnabled, SOUND_ENABLED_PREF_KEY, subscribeCodeBlackSoundEnabled } from "../../services/sound";
import { clearSpotterAccount, loadSpotterAccount, spotterNetworkLogin, subscribeSpotterAccount, type SpotterAccount } from "../../services/spotterAccount";

interface SettingsPageProps {
  cockpitMode: CockpitMode;
  onChangeCockpitMode: (mode: CockpitMode) => void;
  onOpenPiConnection: () => void;
}

export function SettingsPage({ cockpitMode, onChangeCockpitMode, onOpenPiConnection }: SettingsPageProps) {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [piEndpoint, setPiEndpoint] = useState("");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [spotterAccount, setSpotterAccount] = useState<SpotterAccount | null>(null);
  const [spotterUsername, setSpotterUsername] = useState("");
  const [spotterPassword, setSpotterPassword] = useState("");
  const [spotterBusy, setSpotterBusy] = useState(false);
  const [spotterError, setSpotterError] = useState("");
  const [chaserRadiusMiles, setChaserRadiusMiles] = useState(DEFAULT_CHASER_RADIUS_MILES);
  const [chaserRadiusInput, setChaserRadiusInput] = useState(String(DEFAULT_CHASER_RADIUS_MILES));
  const [chaserRadiusSaved, setChaserRadiusSaved] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribePiEndpoint(setPiEndpoint);
    return () => {
      unsubscribe();
    };
  }, []);

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

  return (
    <div className="page-grid page-grid--settings">
      <Panel title="Display" className="settings-display-panel">
        <div className="settings-row">
          <div>
            <strong>Cockpit Mode</strong>
            <span>Chase shows a reduced field set for glancing while driving. Normal shows full detail.</span>
          </div>
          <div className="mode-toggle" aria-label="Cockpit information mode">
            <button className={cockpitMode === "normal" ? "active" : ""} onClick={() => onChangeCockpitMode("normal")}>Normal</button>
            <button className={cockpitMode === "chase" ? "active" : ""} onClick={() => onChangeCockpitMode("chase")}>Chase</button>
          </div>
        </div>
      </Panel>

      <Panel title="Alerts" className="settings-alerts-panel">
        <div className="settings-row">
          <div>
            <strong>Audible Alerts</strong>
            <span>Plays a caution tone when a new tornado warning or PDS-severity alert appears for your location.</span>
          </div>
          <div className="mode-toggle" aria-label="Audible alerts">
            <button className={soundEnabled ? "" : "active"} onClick={() => toggleSound(false)}>Off</button>
            <button className={soundEnabled ? "active" : ""} onClick={() => toggleSound(true)}>On</button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Test Alert Sound</strong>
            <span>{soundEnabled ? "Plays the same tone a real tornado/PDS alert triggers." : "Enable audible alerts above to test."}</span>
          </div>
          <button className="settings-action" disabled={!soundEnabled} onClick={() => emitCodeBlackSound("warning")}>Play Test</button>
        </div>
      </Panel>

      <Panel title="Pi Connection" className="settings-connection-panel">
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
                <span>Powers nearby chasers and, soon, report submission. Stored on this device only.</span>
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
            <span>How far out spotters count as "nearby" on the Weather page. 5-500 mi.</span>
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
  );
}
