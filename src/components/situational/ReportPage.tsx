import { useEffect, useState } from "react";
import { Panel } from "./Panel";
import { usePeakGust } from "../../hooks/usePeakGust";
import { loadSpotterAccount, subscribeSpotterAccount, submitSevereReport, type SevereReportInput, type SpotterAccount } from "../../services/spotterAccount";

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

export function ReportPage({ gps }: { gps: { lat: number; lon: number } | null }) {
  const [account, setAccount] = useState<SpotterAccount | null>(null);
  const [report, setReport] = useState<SevereReportInput>(() => emptyReport(gps));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const peakGust = usePeakGust();

  useEffect(() => {
    const unsubscribe = subscribeSpotterAccount(setAccount);
    void loadSpotterAccount();
    return () => {
      unsubscribe();
    };
  }, []);

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
    return (
      <Panel title="Submit Report" className="report-page-panel">
        <div className="calm-card">Sign in to Spotter Network in Settings before submitting a report.</div>
      </Panel>
    );
  }

  if (sent) {
    return (
      <Panel title="Submit Report" className="report-page-panel">
        <div className="calm-card">Your report was submitted to Spotter Network.</div>
        <div className="nearby-actions report-page-actions">
          <button className="settings-action" onClick={() => { setSent(false); setReport(emptyReport(gps)); }}>Submit Another</button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Spotter Network — Submit Report" className="report-page-panel">
      <div className="report-page-scroll report-form">
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
            {peakGust != null && report.windSpeedMph == null && (
              <button
                type="button"
                className="settings-action report-suggest"
                onClick={() => setReport((prev) => ({ ...prev, windSpeedMph: Math.round(peakGust), windMeasured: true }))}
              >
                Use Peak Gust ({Math.round(peakGust)} mph)
              </button>
            )}
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

        <div className="nearby-actions report-page-actions">
          <button className="settings-action" disabled={busy} onClick={() => void submit()}>{busy ? "Submitting..." : "Submit Report"}</button>
        </div>
      </div>
    </Panel>
  );
}
