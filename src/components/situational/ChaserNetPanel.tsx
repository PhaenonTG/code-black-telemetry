import { useEffect, useMemo, useState } from "react";
import { CHASER_NET_API_CONTRACT, chaserNetDisplayVisibility, getChaserNetServiceStatus } from "../../services/chaserNet";
import {
  DEFAULT_CHASER_NET_PRESENCE_SETTINGS,
  loadChaserNetPresenceSettings,
  saveChaserNetPresenceSettings,
  subscribeChaserNetPresenceSettings,
  type ChaserNetPresenceSettings,
  type ChaserNetPresenceVisibility,
} from "../../services/settings";
import { Panel } from "./Panel";

const visibilityOptions: Array<{ value: ChaserNetPresenceVisibility; label: string; description: string }> = [
  { value: "hidden", label: "Hidden", description: "Do not publish precise Chaser Net location." },
  { value: "team-only", label: "My Team", description: "Precise location is only eligible for authorized team members." },
  { value: "trusted-network", label: "Trusted Net", description: "Eligible verified Chaser Net members may receive permitted presence." },
  { value: "delayed", label: "Delayed", description: "Contract-ready for delayed exposure; not a UI-only timestamp trick." },
];

function statusLabel(state: string) {
  if (state === "not-configured") return "Not Configured";
  if (state === "unauthenticated") return "Signed Out";
  if (state === "not-a-member") return "No Membership";
  if (state === "connected") return "Ready";
  return "Degraded";
}

export function ChaserNetPanel() {
  const [settings, setSettings] = useState<ChaserNetPresenceSettings>(DEFAULT_CHASER_NET_PRESENCE_SETTINGS);
  const serviceStatus = useMemo(() => getChaserNetServiceStatus(), []);
  const backendConfigured = serviceStatus.state !== "not-configured";

  useEffect(() => {
    const unsubscribe = subscribeChaserNetPresenceSettings(setSettings);
    void loadChaserNetPresenceSettings();
    return unsubscribe;
  }, []);

  const update = (patch: Partial<ChaserNetPresenceSettings>) => {
    void saveChaserNetPresenceSettings(patch);
  };

  return (
    <Panel title="Code Black Chaser Net" className="chaser-net-panel">
      <div className="chaser-net-grid">
        <div className="chaser-net-card chaser-net-card--status">
          <span>Network</span>
          <strong>{statusLabel(serviceStatus.state)}</strong>
          <em>{serviceStatus.message}</em>
        </div>
        <div className="chaser-net-card">
          <span>Membership</span>
          <strong>{serviceStatus.member?.membershipState ?? "Not linked"}</strong>
          <em>{serviceStatus.member?.callsign ?? "Authenticated member profile required."}</em>
        </div>
        <div className="chaser-net-card">
          <span>Presence Sharing</span>
          <strong>{backendConfigured && settings.sharePresence ? "Enabled" : "Off"}</strong>
          <em>{backendConfigured ? "Local Chase Tracking remains separate." : "Backend not configured. Nothing is published."}</em>
        </div>
        <div className="chaser-net-card">
          <span>Application Workflow</span>
          <strong>Foundation Ready</strong>
          <em>Screened application and moderator review contracts exist; public submission UI is deferred.</em>
        </div>
      </div>

      <div className="settings-row">
        <div>
          <strong>Share Chaser Net Presence</strong>
          <span>{backendConfigured ? "Controls network publication only. Local Chase breadcrumbs are not uploaded by this switch." : "Unavailable until Chaser Net backend/auth is configured."}</span>
        </div>
        <div className="mode-toggle" aria-label="Chaser Net presence sharing">
          <button className={settings.sharePresence ? "" : "active"} onClick={() => update({ sharePresence: false })}>Off</button>
          <button className={backendConfigured && settings.sharePresence ? "active" : ""} disabled={!backendConfigured} onClick={() => update({ sharePresence: true })}>On</button>
        </div>
      </div>

      <div className="settings-row settings-row--stack">
        <div>
          <strong>Location Sharing</strong>
          <span>Current selection: {chaserNetDisplayVisibility(settings.locationVisibility)}. Hidden is the default for privacy.</span>
        </div>
        <div className="chaser-net-privacy-options">
          {visibilityOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={settings.locationVisibility === option.value ? "active" : ""}
              onClick={() => update({
                locationVisibility: option.value,
                preciseLocationAllowed: option.value !== "hidden" && settings.preciseLocationAllowed,
              })}
            >
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-row">
        <div>
          <strong>Precise Location</strong>
          <span>Must be explicitly allowed before precise live location can publish.</span>
        </div>
        <div className="mode-toggle" aria-label="Precise Chaser Net location">
          <button className={settings.preciseLocationAllowed ? "" : "active"} onClick={() => update({ preciseLocationAllowed: false, shareSpeed: false, shareHeading: false })}>Off</button>
          <button className={settings.preciseLocationAllowed ? "active" : ""} disabled={settings.locationVisibility === "hidden"} onClick={() => update({ preciseLocationAllowed: true })}>On</button>
        </div>
      </div>

      <div className="settings-row">
        <div>
          <strong>Speed / Heading</strong>
          <span>Optional presence details. Missing values are never fabricated.</span>
        </div>
        <div className="layer-row-controls">
          <div className="mode-toggle" aria-label="Share speed">
            <button className={settings.shareSpeed ? "" : "active"} onClick={() => update({ shareSpeed: false })}>Speed Off</button>
            <button className={settings.shareSpeed ? "active" : ""} disabled={!settings.preciseLocationAllowed} onClick={() => update({ shareSpeed: true })}>Speed On</button>
          </div>
          <div className="mode-toggle" aria-label="Share heading">
            <button className={settings.shareHeading ? "" : "active"} onClick={() => update({ shareHeading: false })}>Heading Off</button>
            <button className={settings.shareHeading ? "active" : ""} disabled={!settings.preciseLocationAllowed} onClick={() => update({ shareHeading: true })}>Heading On</button>
          </div>
        </div>
      </div>

      <div className="chaser-net-contract">
        <strong>v0.2 Contracts</strong>
        <span>{CHASER_NET_API_CONTRACT.read.applications.method} {CHASER_NET_API_CONTRACT.read.applications.path} - moderator review queue</span>
        <span>{CHASER_NET_API_CONTRACT.write.applicationDraft.method} {CHASER_NET_API_CONTRACT.write.applicationDraft.path} - authenticated draft</span>
        <span>{CHASER_NET_API_CONTRACT.write.applicationSubmit.method} {CHASER_NET_API_CONTRACT.write.applicationSubmit.path} - screened submission</span>
        <span>{CHASER_NET_API_CONTRACT.write.applicationReview.method} {CHASER_NET_API_CONTRACT.write.applicationReview.path} - moderator decision</span>
        <span>{CHASER_NET_API_CONTRACT.read.presence.method} {CHASER_NET_API_CONTRACT.read.presence.path} - viewport aware</span>
        <span>{CHASER_NET_API_CONTRACT.write.presence.method} {CHASER_NET_API_CONTRACT.write.presence.path} - authenticated</span>
        <span>{CHASER_NET_API_CONTRACT.write.reports.method} {CHASER_NET_API_CONTRACT.write.reports.path} - authenticated Chaser Net human reports</span>
      </div>
    </Panel>
  );
}
