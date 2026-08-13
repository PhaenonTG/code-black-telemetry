import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { Panel } from "./Panel";
import type { NearbyCategory, NearbyPlace } from "../../services/nearby";
import type { Spotter } from "../../services/spotters";
import { loadChaserRadiusMiles, subscribeChaserRadiusMiles } from "../../services/settings";
import { openExternalUrl } from "../../utils/externalLinks";

const CATEGORY_LABEL: Record<NearbyCategory, string> = {
  gas: "Gas",
  hospital: "ER",
  lodging: "Lodging",
  food: "Food",
};

const CATEGORY_ORDER: NearbyCategory[] = ["gas", "hospital", "lodging", "food"];

function hoursLabel(place: NearbyPlace) {
  if (place.hoursStatus === "open") return "OPEN";
  if (place.hoursStatus === "closed") return "CLOSED";
  if (place.hoursStatus === "typical-open") return "TYPICALLY OPEN";
  return "HOURS UNKNOWN";
}

interface NearbyPanelProps {
  places: Partial<Record<NearbyCategory, NearbyPlace>>;
  error: string;
  spotters: Spotter[];
  spottersError: string;
}

export function NearbyPanel({ places, error, spotters, spottersError }: NearbyPanelProps) {
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [spotterListOpen, setSpotterListOpen] = useState(false);
  const [selectedSpotter, setSelectedSpotter] = useState<Spotter | null>(null);
  const [chaserRadiusMiles, setChaserRadiusMiles] = useState(100);
  const hasAny = CATEGORY_ORDER.some((category) => places[category]);
  const withinRadius = spotters.filter((spotter) => spotter.distanceMiles <= chaserRadiusMiles).length;
  const closest = spotters[0];

  useEffect(() => {
    const unsubscribe = subscribeChaserRadiusMiles(setChaserRadiusMiles);
    void loadChaserRadiusMiles();
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <Panel title="Nearby" className="nearby-panel" tone="spc">
      <div className="nearby-list">
        {!hasAny && <div className="calm-card">{error ? "NEARBY LOOKUP UNAVAILABLE" : "SEARCHING NEARBY..."}</div>}
        {CATEGORY_ORDER.map((category) => {
          const place = places[category];
          if (!place) return null;
          return (
            <button key={category} className="nearby-card" onClick={() => setSelectedPlace(place)}>
              <span>{CATEGORY_LABEL[category]}</span>
              <strong>{place.name}</strong>
              <em>
                {place.distanceMiles.toFixed(1)} MI
                <i className={`nearby-hours nearby-hours--${place.hoursStatus}`}>{hoursLabel(place)}</i>
              </em>
            </button>
          );
        })}
        <button className="nearby-card nearby-card--chasers" onClick={() => setSpotterListOpen(true)}>
          <span>Chasers</span>
          <strong>
            {spotters.length === 0
              ? (spottersError ? "UNAVAILABLE" : "SEARCHING...")
              : `${withinRadius} nearby`}
          </strong>
          <em>{closest ? `${closest.name}, ${closest.distanceMiles.toFixed(1)} mi` : ""}</em>
        </button>
      </div>
      {selectedPlace && <NearbyDetailModal place={selectedPlace} onClose={() => setSelectedPlace(null)} />}
      {spotterListOpen && (
        <SpotterListModal
          spotters={spotters.filter((spotter) => spotter.distanceMiles <= chaserRadiusMiles)}
          error={spottersError}
          onClose={() => setSpotterListOpen(false)}
          onSelect={(spotter) => {
            setSpotterListOpen(false);
            setSelectedSpotter(spotter);
          }}
        />
      )}
      {selectedSpotter && (
        <SpotterDetailModal
          spotter={selectedSpotter}
          onClose={() => setSelectedSpotter(null)}
          onBack={() => {
            setSelectedSpotter(null);
            setSpotterListOpen(true);
          }}
        />
      )}
    </Panel>
  );
}

// Universal https links rather than app-only URI schemes (geo:, waze://) — these degrade
// gracefully to opening in a browser if the target app isn't installed, which matters once this
// also ships on iPad/iPhone where geo: doesn't exist at all. Apple Maps only makes sense to offer
// on iOS; Google Maps and Waze both have real cross-platform web fallbacks so they're always shown.
function mapProviderLinks(point: { lat: number; lon: number; name: string }): Array<{ label: string; href: string }> {
  const coords = `${point.lat},${point.lon}`;
  const nameQuery = encodeURIComponent(point.name);
  const links: Array<{ label: string; href: string }> = [];
  if (Capacitor.getPlatform() === "ios") {
    links.push({ label: "Apple Maps", href: `https://maps.apple.com/?q=${nameQuery}&ll=${coords}` });
  }
  links.push({ label: "Google Maps", href: `https://www.google.com/maps/search/?api=1&query=${coords}` });
  links.push({ label: "Waze", href: `https://waze.com/ul?ll=${coords}&navigate=yes` });
  return links;
}

function NearbyDetailModal({ place, onClose }: { place: NearbyPlace; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(place.address || `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied by the WebView; the address is still shown on-screen to read manually.
    }
  };

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="nearby-title">
      <div className="product-modal nearby-modal">
        <div className="modal-head">
          <div>
            <div className="cb-panel__title">{CATEGORY_LABEL[place.category]}</div>
            <h2 id="nearby-title">{place.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">X</button>
        </div>
        <div className="modal-meta">
          <span>{place.distanceMiles.toFixed(1)} MI AWAY</span>
          <span className={`nearby-hours nearby-hours--${place.hoursStatus}`}>{place.hoursText}</span>
        </div>
        <div className="modal-scroll nearby-detail">
          <p>{place.address || "Address not available from map data."}</p>
          {place.phone && <p>{place.phone}</p>}
          {place.beds != null && <p>{place.beds} beds</p>}
          <div className="nearby-actions">
            {mapProviderLinks(place).map((link) => (
              <button key={link.label} type="button" className="settings-action" onClick={() => void openExternalUrl(link.href)}>{link.label}</button>
            ))}
            <button className="settings-action" onClick={copyAddress}>{copied ? "Copied" : "Copy Address"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SpotterListModal({ spotters, error, onClose, onSelect }: { spotters: Spotter[]; error: string; onClose: () => void; onSelect: (spotter: Spotter) => void }) {
  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="spotters-title">
      <div className="product-modal nearby-modal">
        <div className="modal-head">
          <div>
            <div className="cb-panel__title">Spotter Network</div>
            <h2 id="spotters-title">Nearby Chasers</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">X</button>
        </div>
        <div className="modal-scroll nearby-detail">
          {spotters.length === 0 && <p>{error || "No spotter positions available right now."}</p>}
          <div className="spotter-list">
            {spotters.slice(0, 12).map((spotter) => (
              <button key={spotter.id} className="spotter-row" onClick={() => onSelect(spotter)}>
                <strong>{spotter.name}</strong>
                <span>{spotter.distanceMiles.toFixed(1)} MI</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SpotterDetailModal({ spotter, onClose, onBack }: { spotter: Spotter; onClose: () => void; onBack: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyCoordinates = async () => {
    try {
      await navigator.clipboard.writeText(`${spotter.lat.toFixed(5)}, ${spotter.lon.toFixed(5)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied by the WebView; coordinates are still shown on-screen.
    }
  };

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="spotter-title">
      <div className="product-modal nearby-modal">
        <div className="modal-head">
          <button className="icon-button" onClick={onBack} aria-label="Back to list">{"<"}</button>
          <div>
            <div className="cb-panel__title">Spotter Network</div>
            <h2 id="spotter-title">{spotter.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">X</button>
        </div>
        <div className="modal-meta">
          <span>{spotter.distanceMiles.toFixed(1)} MI AWAY</span>
          <span>{spotter.status || "STATUS UNKNOWN"}</span>
        </div>
        <div className="modal-scroll nearby-detail">
          <p>Last reported {spotter.updatedAtText || "time unknown"}</p>
          {spotter.contact.length === 0 && <p>No contact info shared on this spotter's profile.</p>}
          {spotter.contact.map((field) => (
            <p key={field.label}><strong>{field.label}:</strong> {field.value}</p>
          ))}
          <div className="nearby-actions">
            {mapProviderLinks(spotter).map((link) => (
              <button key={link.label} type="button" className="settings-action" onClick={() => void openExternalUrl(link.href)}>{link.label}</button>
            ))}
            <button className="settings-action" onClick={copyCoordinates}>{copied ? "Copied" : "Copy Coordinates"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
