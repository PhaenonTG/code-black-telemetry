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
import { ColorField } from "../map/ColorWheel";
import { downscaleImageToDataUrl } from "../../utils/image";
import { LayerGlyph, type LayerVisual } from "./LayerGlyph";

const DEFAULT_VISIBILITY: MapLayerVisibility = {
  alerts: true,
  team: true,
  chasers: true,
  poi: true,
  mosaic: true,
  roadConditions: false,
  trafficCameras: false,
  probes: false,
  chaserNet: false,
  breadcrumbs: true,
};

const LAYERS: Array<{ key: keyof MapLayerVisibility; label: string; source: string; status: string; description: string; configured?: boolean; visual: LayerVisual }> = [
  {
    key: "mosaic",
    label: "Wide-Area Mosaic",
    source: "IEM NEXRAD",
    status: "Live mosaic",
    visual: "radar",
    description: "National NEXRAD composite reflectivity, auto-refreshing every few minutes -- the default live radar view on the map.",
  },
  {
    key: "alerts",
    label: "Alerts (Watches + Warnings + MD)",
    source: "NWS / SPC",
    status: "Provider-backed",
    visual: "alerts",
    description: "NWS watch/warning polygons and SPC Mesoscale Discussions. Tap a polygon on the map for details.",
  },
  {
    key: "team",
    label: "Team",
    source: "Local roster",
    status: "User-configured",
    visual: "team",
    description: "Your curated team roster's positions, always shown regardless of distance. Manage the roster in Settings -> Teams.",
  },
  {
    key: "chasers",
    label: "Spotter Network",
    source: "Spotter Network",
    status: "Radius-bounded",
    visual: "spotter",
    description: "Nearby Spotter Network positions, bounded by your search radius (Settings -> Nearby Chasers).",
  },
  {
    key: "poi",
    label: "Gas / Food / ER",
    source: "OpenStreetMap",
    status: "Filtered",
    visual: "poi",
    description: "ER pins always show when nearby. Gas and food only show for the specific businesses below -- add one to put it on the map.",
  },
  {
    key: "breadcrumbs",
    label: "Trail",
    source: "Local device",
    status: "Local only",
    visual: "trail",
    description: "Your local rolling chase trail. Captured independently of whether the map page is visible.",
  },
  {
    key: "roadConditions",
    label: "Road Conditions",
    source: "ARDOT, KDOT, MoDOT, ODOT",
    status: "AR/KS/MO/OK coverage",
    visual: "road",
    description: "Public DOT closures, crashes, flooding, construction, lane restrictions, and route-impacting hazards. Coverage: Arkansas DOT IDrive, Kansas DOT KanDrive, Missouri DOT Traveler Information, Oklahoma DOT WZDx; other areas report outside coverage.",
  },
  {
    key: "trafficCameras",
    label: "Traffic / Public Cameras",
    source: "ARDOT, KDOT, MoDOT",
    status: "AR/KS/MO public",
    visual: "camera",
    description: "Legitimate public transportation cameras. Coverage: Arkansas DOT IDrive, Kansas DOT KanDrive, Missouri DOT Traveler Information; images load only when a marker detail is opened.",
  },
  {
    key: "probes",
    label: "Code Black Probes",
    source: "Code Black",
    status: "Deferred",
    visual: "probe",
    description: "Prepared for future deployable probe observations. Live probe provider not configured yet.",
    configured: false,
  },
  {
    key: "chaserNet",
    label: "Code Black Chaser Net",
    source: "Code Black",
    status: "Backend deferred",
    visual: "network",
    description: "Prepared for verified members, privacy-aware presence, and zoom clustering. Backend not configured yet.",
    configured: false,
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
  const [customPinError, setCustomPinError] = useState("");
  const newPinImageInputRef = useRef<HTMLInputElement>(null);
  const normalizedNewPinName = newPinName.trim().toLowerCase();
  const duplicateCustomPin = Boolean(normalizedNewPinName && customPins.some((pin) => pin.name.trim().toLowerCase() === normalizedNewPinName));

  useEffect(() => {
    const unsubscribe = subscribeMapLayerVisibility(setVisibility);
    void loadMapLayerVisibility();
    return unsubscribe;
  }, []);

  // Explicit target value, not a blind flip -- these buttons are an On/Off pair (like Cockpit
  // Mode/Night Vision in Settings), not a single toggle split across two elements. A blind flip
  // meant clicking the already-active button (e.g. "On" while already On) turned the layer OFF
  // instead of leaving it alone, since both buttons called the same flip regardless of which was
  // clicked.
  const setLayerVisible = (key: keyof MapLayerVisibility, value: boolean) => {
    void saveMapLayerVisibility({ ...visibility, [key]: value });
  };

  const handleNewPinImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setNewPinImage(await downscaleImageToDataUrl(file, CUSTOM_PIN_IMAGE_SIZE_PX));
      setCustomPinError("");
    } catch {
      setCustomPinError("Logo image could not be read. Pick another image or add the pin without a logo.");
    }
  };

  const addCustomPin = () => {
    const name = newPinName.trim();
    if (!name) return;
    if (customPins.some((pin) => pin.name.trim().toLowerCase() === name.toLowerCase())) {
      setCustomPinError("That custom pin already exists.");
      return;
    }
    void saveCustomPoiPins([
      ...customPins,
      { id: `${name}-${Date.now()}`, name, matchText: name, color: newPinColor, imageDataUrl: newPinImage },
    ]);
    setNewPinName("");
    setNewPinImage(undefined);
    setCustomPinError("");
  };

  const removeCustomPin = (id: string) => {
    void saveCustomPoiPins(customPins.filter((pin) => pin.id !== id));
  };

  return (
    <Panel title="Layer Configuration" className="layer-config-panel">
      {LAYERS.map(({ key, label, source, status, description, visual, configured = true }) => (
        <div key={key} className="settings-row layer-config-row" data-testid={`layer-row-${key}`}>
          <div className="layer-config-row__summary">
            <span className="layer-config-row__icon"><LayerGlyph visual={visual} /></span>
            <div>
              <strong>{label}</strong>
              <span>{source} - {configured ? status : "Unavailable"}</span>
              <em>{description}</em>
            </div>
          </div>
          <div className="layer-row-controls">
            {key === "team" && (
              <PinStyleField label="Team Pin" style={teamPinStyle} onChange={(style) => void saveTeamPinStyle(style)} />
            )}
            {key === "chasers" && (
              <PinStyleField label="Chaser Pin" style={chaserPinStyle} onChange={(style) => void saveChaserPinStyle(style)} />
            )}
            <div className="mode-toggle" aria-label={`${label} visibility`}>
              <button className={visibility[key] ? "" : "active"} onClick={() => setLayerVisible(key, false)}>Off</button>
              <button className={configured && visibility[key] ? "active" : ""} disabled={!configured} onClick={() => setLayerVisible(key, true)}>{configured ? "On" : "Unavailable"}</button>
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
            onChange={(event) => {
              setNewPinName(event.target.value);
              setCustomPinError("");
            }}
            onKeyDown={(event) => { if (event.key === "Enter") addCustomPin(); }}
          />
          <ColorField label="Custom pin color" value={newPinColor} onChange={setNewPinColor} />
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
          <button className="settings-action" disabled={!newPinName.trim() || duplicateCustomPin} onClick={addCustomPin}>Add</button>
        </div>
        {customPinError && <div className="cb-note cb-note--warn">{customPinError}</div>}
        {customPins.length > 0 && (
          <div className="settings-roster-list">
            {customPins.map((pin) => (
              <div key={pin.id} className="settings-roster-chip">
                <PinStylePreview style={{ color: pin.color, shape: "circle", sizeScale: 1 }} size={14} />
                <span>{pin.name}</span>
                <button type="button" aria-label={`Remove ${pin.name}`} onClick={() => removeCustomPin(pin.id)}>X</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
