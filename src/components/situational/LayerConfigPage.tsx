import { useEffect, useState } from "react";
import { Panel } from "./Panel";
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
    settingsHint: "Manage roster and pin style in Settings -> Teams / Map Pins.",
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

// A single page for every togglable map layer -- previously each layer's on/off state only lived
// in a small on-map popover (still there, for quick access while looking at the map) with no way
// to reach it except from inside the map card itself. Reachable from the dock corner on any page,
// which is why the underlying visibility state lives in a shared store (services/settings.ts)
// rather than staying local to whichever AtlasMap instance happened to render the popover last.
export function LayerConfigPage() {
  const [visibility, setVisibility] = useState<MapLayerVisibility>(DEFAULT_VISIBILITY);

  useEffect(() => {
    const unsubscribe = subscribeMapLayerVisibility(setVisibility);
    void loadMapLayerVisibility();
    return unsubscribe;
  }, []);

  const toggle = (key: keyof MapLayerVisibility) => {
    void saveMapLayerVisibility({ ...visibility, [key]: !visibility[key] });
  };

  return (
    <Panel title="Layer Configuration" className="layer-config-panel">
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
    </Panel>
  );
}
