import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Panel } from "./Panel";
import {
  loadMapLayerVisibility,
  saveChaserPinStyle,
  saveCustomPoiPins,
  saveMapLayerVisibility,
  saveTeamPinStyle,
  subscribeMapLayerVisibility,
  type MapLayerVisibility,
} from "../../services/settings";
import { useChaserPinStyle, useTeamPinStyle } from "../../hooks/usePinStyle";
import { useCustomPoiPins } from "../../hooks/useCustomPoiPins";
import { PinStyleField, PinStylePreview } from "../map/PinStyleEditor";
import { downscaleImageToDataUrl } from "../../utils/image";

const DEFAULT_VISIBILITY: MapLayerVisibility = { alerts: true, team: true, chasers: true, poi: true, mosaic: true };

const LAYERS: Array<{ key: keyof MapLayerVisibility; label: string; description: string }> = [
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
    description: "Your curated team roster's positions, always shown regardless of distance. Manage the roster in Settings -> Teams.",
  },
  {
    key: "chasers",
    label: "Chasers",
    description: "Nearby Spotter Network positions, bounded by your search radius (Settings -> Nearby Chasers).",
  },
  {
    key: "poi",
    label: "Gas / Food / ER",
    description: "ER pins always show when nearby. Gas and food only show for the specific businesses below -- add one to put it on the map.",
  },
];

const CUSTOM_PIN_IMAGE_SIZE_PX = 64;

// A single page for every togglable map layer -- previously each layer's on/off state only lived
// in a small on-map popover (still there, for quick access while looking at the map) with no way
// to reach it except from inside the map card itself. Reachable from the dock corner on any page,
// which is why the underlying visibility state lives in a shared store (services/settings.ts)
// rather than staying local to whichever AtlasMap instance happened to render the popover last.
// Team/Chaser pin color+shape and the custom Gas/Food pin list live here too now (moved from
// Settings) -- they're properties of a layer, so they belong on the page that's about layers.
export function LayerConfigPage() {
  const [visibility, setVisibility] = useState<MapLayerVisibility>(DEFAULT_VISIBILITY);
  const teamPinStyle = useTeamPinStyle();
  const chaserPinStyle = useChaserPinStyle();
  const customPins = useCustomPoiPins();
  const [newPinName, setNewPinName] = useState("");
  const [newPinColor, setNewPinColor] = useState("#ffbe3c");
  const [newPinImage, setNewPinImage] = useState<string | undefined>(undefined);
  const newPinImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = subscribeMapLayerVisibility(setVisibility);
    void loadMapLayerVisibility();
    return unsubscribe;
  }, []);

  const toggle = (key: keyof MapLayerVisibility) => {
    void saveMapLayerVisibility({ ...visibility, [key]: !visibility[key] });
  };

  const handleNewPinImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setNewPinImage(await downscaleImageToDataUrl(file, CUSTOM_PIN_IMAGE_SIZE_PX));
    } catch {
      // Unreadable/corrupt file -- leave whatever image (if any) was already staged.
    }
  };

  const addCustomPin = () => {
    const name = newPinName.trim();
    if (!name) return;
    void saveCustomPoiPins([
      ...customPins,
      { id: `${name}-${Date.now()}`, name, matchText: name, color: newPinColor, imageDataUrl: newPinImage },
    ]);
    setNewPinName("");
    setNewPinImage(undefined);
  };

  const removeCustomPin = (id: string) => {
    void saveCustomPoiPins(customPins.filter((pin) => pin.id !== id));
  };

  return (
    <Panel title="Layer Configuration" className="layer-config-panel">
      {LAYERS.map(({ key, label, description }) => (
        <div key={key} className="settings-row">
          <div>
            <strong>{label}</strong>
            <span>{description}</span>
          </div>
          <div className="layer-row-controls">
            {key === "team" && (
              <PinStyleField label="Team Pin" style={teamPinStyle} onChange={(style) => void saveTeamPinStyle(style)} />
            )}
            {key === "chasers" && (
              <PinStyleField label="Chaser Pin" style={chaserPinStyle} onChange={(style) => void saveChaserPinStyle(style)} />
            )}
            <div className="mode-toggle" aria-label={`${label} visibility`}>
              <button className={visibility[key] ? "" : "active"} onClick={() => toggle(key)}>Off</button>
              <button className={visibility[key] ? "active" : ""} onClick={() => toggle(key)}>On</button>
            </div>
          </div>
        </div>
      ))}

      <div className="settings-row settings-row--stack">
        <div>
          <strong>Custom Pins</strong>
          <span>A business name to match (e.g. "Love's"), a color, and optionally a logo image. Matching gas/food places within range render with this pin instead of being hidden.</span>
        </div>
        <div className="settings-pin-control">
          <input
            className="settings-input"
            placeholder="Business name (e.g. Love's)"
            value={newPinName}
            onChange={(event) => setNewPinName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") addCustomPin(); }}
          />
          <input type="color" value={newPinColor} onChange={(event) => setNewPinColor(event.target.value)} />
          <button
            type="button"
            className={newPinImage ? "settings-shape-custom active" : "settings-shape-custom"}
            aria-label="Upload logo image"
            style={newPinImage ? { backgroundImage: `url(${newPinImage})` } : undefined}
            onClick={() => newPinImageInputRef.current?.click()}
          >
            {!newPinImage && "LOGO"}
          </button>
          <input ref={newPinImageInputRef} type="file" accept="image/*" className="settings-file-input" onChange={(event) => void handleNewPinImage(event)} />
          <button className="settings-action" disabled={!newPinName.trim()} onClick={addCustomPin}>Add</button>
        </div>
        {customPins.length > 0 && (
          <div className="settings-roster-list">
            {customPins.map((pin) => (
              <div key={pin.id} className="settings-roster-chip">
                <PinStylePreview style={{ color: pin.color, shape: "circle", sizeScale: 1 }} size={14} />
                <span>{pin.name}</span>
                <button type="button" aria-label={`Remove ${pin.name}`} onClick={() => removeCustomPin(pin.id)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
