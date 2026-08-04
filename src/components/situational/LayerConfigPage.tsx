import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  loadMapLayerVisibility,
  saveMapLayerVisibility,
  subscribeMapLayerVisibility,
  type MapLayerVisibility,
} from "../../services/settings";

const DEFAULT_VISIBILITY: MapLayerVisibility = { alerts: true, team: true, chasers: true, poi: true, mosaic: true };

const LAYERS: Array<{ key: keyof MapLayerVisibility; label: string; description: string; settingsHint?: string }> = [
  {
    key: "mosaic",
    label: "Wide-Area Mosaic",
    description: "National radar composite, animated on a loop -- broad situational context alongside the single-site radar.",
  },
  {
    key: "alerts",
    label: "Alerts (Watches + Warnings + MD)",
    description: "NWS watch/warning polygons and SPC Mesoscale Discussions. Tap a polygon on the map for details.",
  },
  {
    key: "team",
    label: "Team",
    description: "Your curated team roster's positions, always shown regardless of distance.",
    settingsHint: "Manage roster and pin style in Settings -> Team Roster / Map Pins.",
  },
  {
    key: "chasers",
    label: "Chasers",
    description: "Nearby Spotter Network positions, bounded by your search radius.",
    settingsHint: "Adjust radius and pin style in Settings -> Nearby Chasers / Map Pins.",
  },
  {
    key: "poi",
    label: "Gas / Food POIs",
    description: "Nearby fuel and food stops. Favorite brands render larger and brighter.",
    settingsHint: "Manage favorite brands in Settings -> Favorite Brands.",
  },
];

// A single full-screen config surface for every togglable map layer -- previously each layer's
// on/off state only lived in a small on-map popover (still there, for quick access while looking
// at the map) with no way to reach it except from inside the map card itself. This is reachable
// from the dock corner on any page, which is why the underlying visibility state had to move to a
// shared store (services/settings.ts) rather than staying local to whichever AtlasMap instance
// happened to render the popover last.
export function LayerConfigPage({ onClose }: { onClose: () => void }) {
  const [visibility, setVisibility] = useState<MapLayerVisibility>(DEFAULT_VISIBILITY);

  useEffect(() => {
    const unsubscribe = subscribeMapLayerVisibility(setVisibility);
    void loadMapLayerVisibility();
    return unsubscribe;
  }, []);

  const toggle = (key: keyof MapLayerVisibility) => {
    void saveMapLayerVisibility({ ...visibility, [key]: !visibility[key] });
  };

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="layer-config-title">
      <div className="product-modal layer-config-modal">
        <div className="modal-head">
          <div>
            <div className="cb-panel__title">Situational Map</div>
            <h2 id="layer-config-title">Layer Configuration</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">X</button>
        </div>
        <div className="modal-scroll">
          {LAYERS.map(({ key, label, description, settingsHint }) => (
            <div key={key} className="settings-row">
              <div>
                <strong>{label}</strong>
                <span>{description}</span>
                {settingsHint && <em>{settingsHint}</em>}
              </div>
              <div className="mode-toggle" aria-label={`${label} visibility`}>
                <button className={visibility[key] ? "" : "active"} onClick={() => toggle(key)}>Off</button>
                <button className={visibility[key] ? "active" : ""} onClick={() => toggle(key)}>On</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
