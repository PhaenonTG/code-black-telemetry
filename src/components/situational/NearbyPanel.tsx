import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { Panel } from "./Panel";
import type { NearbyCategory, NearbyPlace } from "../../services/nearby";
import type { Spotter } from "../../services/spotters";
import { loadChaserRadiusMiles, subscribeChaserRadiusMiles } from "../../services/settings";
import { loadSpotterAccount, subscribeSpotterAccount, submitSevereReport, type SevereReportInput, type SpotterAccount } from "../../services/spotterAccount";

const CATEGORY_LABEL: Record<NearbyCategory, string> = {
  gas: "Gas",
  hospital: "Hospital",
  lodging: "Lodging",
  food: "Food",
};

const CATEGORY_ORDER: NearbyCategory[] = ["gas", "hospital", "lodging", "food"];

function hoursLabel(place: NearbyPlace) {
  if (place.hoursStatus === "open") return "OPEN";
  if (place.hoursStatus === "closed") return "CLOSED";
  return "HOURS UNKNOWN";
}

interface NearbyPanelProps {
  places: Partial<Record<NearbyCategory, NearbyPlace>>;
  error: string;
  spotters: Spotter[];
  spottersError: string;
  gps: { lat: number; lon: number } | null;
}

export function NearbyPanel({ places, error, spotters, spottersError, gps }: NearbyPanelProps) {
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [spotterListOpen, setSpotterListOpen] = useState(false);
  const [selectedSpotter, setSelectedSpotter] = useState<Spotter | null>(null);
  const [chaserRadiusMiles, setChaserRadiusMiles] = useState(100);
  const [reportOpen, setReportOpen] = useState(false);
  const [spotterAccount, setSpotterAccount] = useState<SpotterAccount | null>(null);
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

  useEffect(() => {
    const unsubscribe = subscribeSpotterAccount(setSpotterAccount);
    void loadSpotterAccount();
    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <Panel title="Nearby" className="threats-panel nearby-panel" tone="spc">
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
        <button className="nearby-card nearby-card--report" onClick={() => setReportOpen(true)}>
          <span>Spotter Network</span>
          <strong>Submit Report</strong>
          <em>{spotterAccount ? "SIGNED IN" : "SIGN IN REQUIRED"}</em>
        </button>
      </div>
      {selectedPlace && <NearbyDetailModal place={selectedPlace} onClose={() => setSelectedPlace(null)} />}
      {reportOpen && <ReportModal account={spotterAccount} gps={gps} onClose={() => setReportOpen(false)} />}
      {spotterListOpen && (
        <SpotterListModal
          spotters={spotters}
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
          <div className="nearby-actions">
            {mapProviderLinks(place).map((link) => (
              <a key={link.label} className="settings-action" href={link.href}>{link.label}</a>
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
              <a key={link.label} className="settings-action" href={link.href}>{link.label}</a>
            ))}
            <button className="settings-action" onClick={copyCoordinates}>{copied ? "Copied" : "Copy Coordinates"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const HAZARD_FIELDS: Array<{ key: keyof Pick<SevereReportInput, "tornado" | "funnelCloud" | "wallCloud" | "rotation" | "hail" | "wind" | "flood" | "flashFlood" | "other">; label: string }> = [
  { key: "tornado", label: "Tornado" },
  { key: "funnelCloud", label: "Funnel Cloud" },
  { key: "wallCloud", label: "Wall Cloud" },
  { key: "rotation", label: "Rotation" },
  { key: "hail", label: "Hail" },
  { key: "wind", label: "Wind Damage/Gust" },
  { key: "flood", label: "Flooding" },
  { key: "flashFlood", label: "Flash Flood" },
  { key: "other", label: "Other" },
];

function emptyReport(gps: { lat: number; lon: number } | null): SevereReportInput {
  return {
    reportType: "S",
    tornado: false,
    funnelCloud: false,
    wallCloud: false,
    rotation: false,
    hail: false,
    wind: false,
    flood: false,
    flashFlood: false,
    other: false,
    hailSizeIn: null,
    windSpeedMph: null,
    windMeasured: false,
    damage: false,
    injury: false,
    narrative: "",
    lat: gps?.lat ?? 0,
    lon: gps?.lon ?? 0,
    gpsSourced: gps != null,
    postToNwsChat: true,
    postToTwitter: true,
  };
}

function ReportModal({ account, gps, onClose }: { account: SpotterAccount | null; gps: { lat: number; lon: number } | null; onClose: () => void }) {
  const [report, setReport] = useState<SevereReportInput>(() => emptyReport(gps));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const toggleHazard = (key: (typeof HAZARD_FIELDS)[number]["key"]) => {
    setReport((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const submit = async () => {
    if (!gps) {
      setError("No GPS fix yet — can't submit a report without a location.");
      return;
    }
    const anyHazard = HAZARD_FIELDS.some((field) => report[field.key]);
    if (!anyHazard) {
      setError("Select at least one hazard type.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await submitSevereReport({ ...report, lat: gps.lat, lon: gps.lon, gpsSourced: true });
    setBusy(false);
    if (result.success) {
      setSent(true);
    } else {
      setError(result.error);
    }
  };

  if (!account) {
    return createPortal(
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div className="product-modal nearby-modal">
          <div className="modal-head">
            <div>
              <div className="cb-panel__title">Spotter Network</div>
              <h2 id="report-title">Submit Report</h2>
            </div>
            <button className="icon-button" onClick={onClose} aria-label="Close">X</button>
          </div>
          <div className="modal-scroll nearby-detail">
            <p>Sign in to Spotter Network in Settings before submitting a report.</p>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  if (sent) {
    return createPortal(
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div className="product-modal nearby-modal">
          <div className="modal-head">
            <div>
              <div className="cb-panel__title">Spotter Network</div>
              <h2 id="report-title">Report Sent</h2>
            </div>
            <button className="icon-button" onClick={onClose} aria-label="Close">X</button>
          </div>
          <div className="modal-scroll nearby-detail">
            <p>Your report was submitted to Spotter Network.</p>
            <div className="nearby-actions">
              <button className="settings-action" onClick={() => { setSent(false); setReport(emptyReport(gps)); }}>Submit Another</button>
              <button className="settings-action" onClick={onClose}>Done</button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <div className="product-modal nearby-modal report-modal">
        <div className="modal-head">
          <div>
            <div className="cb-panel__title">Spotter Network</div>
            <h2 id="report-title">Submit Report</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">X</button>
        </div>
        <div className="modal-scroll nearby-detail report-form">
          <div className="report-section">
            <div className="mode-toggle" aria-label="Report type">
              <button className={report.reportType === "S" ? "active" : ""} onClick={() => setReport((prev) => ({ ...prev, reportType: "S" }))}>Severe</button>
              <button className={report.reportType === "W" ? "active" : ""} onClick={() => setReport((prev) => ({ ...prev, reportType: "W" }))}>Winter</button>
            </div>
          </div>

          <div className="report-section">
            <strong>Hazards</strong>
            <div className="report-checkbox-grid">
              {HAZARD_FIELDS.map((field) => (
                <label key={field.key} className="report-checkbox">
                  <input type="checkbox" checked={report[field.key]} onChange={() => toggleHazard(field.key)} />
                  {field.label}
                </label>
              ))}
            </div>
          </div>

          {report.hail && (
            <div className="report-section">
              <label className="report-field">
                <span>Hail Size (in)</span>
                <input
                  className="settings-input"
                  type="number"
                  inputMode="decimal"
                  step="0.25"
                  min={0}
                  value={report.hailSizeIn ?? ""}
                  onChange={(event) => setReport((prev) => ({ ...prev, hailSizeIn: event.target.value === "" ? null : Number(event.target.value) }))}
                />
              </label>
            </div>
          )}

          {report.wind && (
            <div className="report-section">
              <label className="report-field">
                <span>Wind Speed (mph)</span>
                <input
                  className="settings-input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={report.windSpeedMph ?? ""}
                  onChange={(event) => setReport((prev) => ({ ...prev, windSpeedMph: event.target.value === "" ? null : Number(event.target.value) }))}
                />
              </label>
              <div className="mode-toggle" aria-label="Wind measurement">
                <button className={!report.windMeasured ? "active" : ""} onClick={() => setReport((prev) => ({ ...prev, windMeasured: false }))}>Estimated</button>
                <button className={report.windMeasured ? "active" : ""} onClick={() => setReport((prev) => ({ ...prev, windMeasured: true }))}>Measured</button>
              </div>
            </div>
          )}

          <div className="report-section">
            <div className="report-checkbox-grid">
              <label className="report-checkbox">
                <input type="checkbox" checked={report.damage} onChange={() => setReport((prev) => ({ ...prev, damage: !prev.damage }))} />
                Damage Observed
              </label>
              <label className="report-checkbox">
                <input type="checkbox" checked={report.injury} onChange={() => setReport((prev) => ({ ...prev, injury: !prev.injury }))} />
                Injury Reported
              </label>
            </div>
          </div>

          <div className="report-section">
            <label className="report-field">
              <span>Narrative</span>
              <textarea
                className="settings-input report-narrative"
                rows={3}
                value={report.narrative}
                onChange={(event) => setReport((prev) => ({ ...prev, narrative: event.target.value }))}
                placeholder="Brief description of what you're observing"
              />
            </label>
          </div>

          <div className="report-section">
            <div className="report-checkbox-grid">
              <label className="report-checkbox">
                <input type="checkbox" checked={report.postToNwsChat} onChange={() => setReport((prev) => ({ ...prev, postToNwsChat: !prev.postToNwsChat }))} />
                Post to NWSChat
              </label>
              <label className="report-checkbox">
                <input type="checkbox" checked={report.postToTwitter} onChange={() => setReport((prev) => ({ ...prev, postToTwitter: !prev.postToTwitter }))} />
                Post to Twitter
              </label>
            </div>
          </div>

          <div className="report-section">
            <span className="report-gps-line">{gps ? `GPS ${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}` : "NO GPS FIX"}</span>
          </div>

          {error && <div className="cb-note cb-note--warn">{error}</div>}

          <div className="nearby-actions">
            <button className="settings-action" disabled={busy} onClick={() => void submit()}>{busy ? "Submitting..." : "Submit Report"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
