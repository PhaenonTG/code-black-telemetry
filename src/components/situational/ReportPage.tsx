import { useEffect, useState } from "react";
import { Panel } from "./Panel";
import { usePeakGust } from "../../hooks/usePeakGust";
import { useStormReports } from "../../hooks/useStormReports";
import {
  DEFAULT_REPORT_FEED_RADIUS_MILES,
  DEFAULT_REPORT_FEED_RETENTION_HOURS,
  loadReportFeedRadiusMiles,
  loadReportFeedRetentionHours,
  saveReportFeedRadiusMiles,
  saveReportFeedRetentionHours,
  subscribeReportFeedRadiusMiles,
  subscribeReportFeedRetentionHours,
} from "../../services/settings";
import { loadSpotterAccount, subscribeSpotterAccount, submitSevereReport, type SevereReportInput, type SpotterAccount } from "../../services/spotterAccount";
import { reportAgeText, type StormReport } from "../../services/stormReports";

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

const REPORT_RADIUS_OPTIONS = [10, 25, 50, 100];
const REPORT_RETENTION_OPTIONS = [1, 3, 6, 12, 24];
type ReportFeedFilter = "all" | "spotter" | "nws";

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

export function ReportPage({ gps, onOpenSettings }: { gps: { lat: number; lon: number } | null; onOpenSettings: () => void }) {
  const [account, setAccount] = useState<SpotterAccount | null>(null);
  const [report, setReport] = useState<SevereReportInput>(() => emptyReport(gps));
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_REPORT_FEED_RADIUS_MILES);
  const [retentionHours, setRetentionHours] = useState(DEFAULT_REPORT_FEED_RETENTION_HOURS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const peakGust = usePeakGust();
  const feed = useStormReports(gps, radiusMiles, retentionHours);
  const anyHazard = HAZARD_FIELDS.some((field) => report[field.key]);
  const canSubmit = Boolean(gps && anyHazard && !busy);

  useEffect(() => {
    const unsubscribe = subscribeSpotterAccount(setAccount);
    void loadSpotterAccount();
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribeRadius = subscribeReportFeedRadiusMiles(setRadiusMiles);
    const unsubscribeRetention = subscribeReportFeedRetentionHours(setRetentionHours);
    void loadReportFeedRadiusMiles();
    void loadReportFeedRetentionHours();
    return () => {
      unsubscribeRadius();
      unsubscribeRetention();
    };
  }, []);

  const toggleHazard = (key: (typeof HAZARD_FIELDS)[number]["key"]) => {
    setReport((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const submit = async () => {
    if (!gps) {
      setError("No GPS fix yet - can't submit a report without a location.");
      return;
    }
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

  const formPanel = !account ? (
    <Panel title="Submit Report" className="report-page-panel report-compose-panel report-compose-panel--locked">
      <div className="calm-card">Sign in to Spotter Network in Settings before submitting a report.</div>
      <div className="nearby-actions report-page-actions">
        <button className="settings-action" onClick={onOpenSettings}>Open Spotter Settings</button>
      </div>
    </Panel>
  ) : sent ? (
    <Panel title="Submit Report" className="report-page-panel report-compose-panel">
      <div className="calm-card">Your report was submitted to Spotter Network.</div>
      <div className="nearby-actions report-page-actions">
        <button className="settings-action" onClick={() => { setSent(false); setReport(emptyReport(gps)); }}>Submit Another</button>
      </div>
    </Panel>
  ) : (
    <Panel title="Spotter Network - Submit Report" className="report-page-panel report-compose-panel">
      <div className="report-page-scroll report-form">
        <div className="report-section">
          <div className="cb-note">Severe weather reports submit to Spotter Network with your current GPS position.</div>
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
          <button className="settings-action" disabled={!canSubmit} onClick={() => void submit()}>{busy ? "Submitting..." : "Submit Report"}</button>
        </div>
      </div>
    </Panel>
  );

  return (
    <>
      {formPanel}
      <StormReportFeedPanel
        gps={gps}
        reports={feed.reports}
        error={feed.error}
        updatedAt={feed.updatedAt}
        radiusMiles={radiusMiles}
        retentionHours={retentionHours}
        onChangeRadius={(miles) => void saveReportFeedRadiusMiles(miles)}
        onChangeRetention={(hours) => void saveReportFeedRetentionHours(hours)}
      />
    </>
  );
}

function StormReportFeedPanel({
  gps,
  reports,
  error,
  updatedAt,
  radiusMiles,
  retentionHours,
  onChangeRadius,
  onChangeRetention,
}: {
  gps: { lat: number; lon: number } | null;
  reports: StormReport[];
  error: string;
  updatedAt: number | null;
  radiusMiles: number;
  retentionHours: number;
  onChangeRadius: (miles: number) => void;
  onChangeRetention: (hours: number) => void;
}) {
  const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "WAITING";
  const [sourceFilter, setSourceFilter] = useState<ReportFeedFilter>("all");
  const spotterCount = reports.filter((report) => report.source === "Spotter Network").length;
  const nwsCount = reports.length - spotterCount;
  const latestReport = reports[0] ?? null;
  const nearestReport = reports.reduce<StormReport | null>((nearest, report) => (
    nearest == null || report.distanceMiles < nearest.distanceMiles ? report : nearest
  ), null);
  const visibleReports = reports.filter((report) => {
    if (sourceFilter === "spotter") return report.source === "Spotter Network";
    if (sourceFilter === "nws") return report.source === "NWS";
    return true;
  });
  const emptyMessage = sourceFilter === "spotter"
    ? "NO SPOTTER NETWORK REPORTS IN RANGE"
    : sourceFilter === "nws"
      ? "NO NWS LOCAL STORM REPORTS IN RANGE"
      : "NO NWS OR SPOTTER NETWORK REPORTS IN RANGE";
  return (
    <Panel title={`Nearby Reports ${reports.length ? reports.length : ""}`} className="report-page-panel report-feed-panel" tone={reports.length ? "red" : "default"}>
      <div className="report-feed-controls">
        <div className="mode-toggle report-feed-toggle" aria-label="Report feed radius">
          {REPORT_RADIUS_OPTIONS.map((miles) => (
            <button key={miles} className={radiusMiles === miles ? "active" : ""} onClick={() => onChangeRadius(miles)}>{miles} mi</button>
          ))}
        </div>
        <div className="mode-toggle report-feed-toggle" aria-label="Report feed retention">
          {REPORT_RETENTION_OPTIONS.map((hours) => (
            <button key={hours} className={retentionHours === hours ? "active" : ""} onClick={() => onChangeRetention(hours)}>{hours}h</button>
          ))}
        </div>
      </div>
      <div className="report-feed-source-controls" aria-label="Report source filter">
        <button className={sourceFilter === "all" ? "active" : ""} onClick={() => setSourceFilter("all")}>All {reports.length}</button>
        <button className={sourceFilter === "spotter" ? "active" : ""} onClick={() => setSourceFilter("spotter")}>Spotter {spotterCount}</button>
        <button className={sourceFilter === "nws" ? "active" : ""} onClick={() => setSourceFilter("nws")}>NWS {nwsCount}</button>
      </div>
      <div className="report-feed-meta">
        <span>{gps ? `WITHIN ${radiusMiles} MI` : "NO GPS FIX"}</span>
        <span>KEEP {retentionHours}H</span>
        <span>UPDATED {updatedLabel}</span>
      </div>
      <div className="report-feed-summary">
        <div>
          <span>Latest</span>
          <strong>{latestReport ? `${latestReport.type} - ${reportAgeText(latestReport.validTime)}` : "No reports"}</strong>
        </div>
        <div>
          <span>Nearest</span>
          <strong>{nearestReport ? `${nearestReport.type} - ${nearestReport.distanceMiles.toFixed(1)} MI` : "No reports"}</strong>
        </div>
      </div>
      <div className="report-feed-list">
        {!gps && <div className="calm-card">Waiting for GPS before loading nearby Local Storm Reports.</div>}
        {gps && error && <div className="cb-note cb-note--warn">{error}</div>}
        {gps && !error && visibleReports.length === 0 && <div className="calm-card">{emptyMessage}</div>}
        {visibleReports.map((item) => <StormReportRow key={item.id} report={item} />)}
      </div>
    </Panel>
  );
}

function StormReportRow({ report }: { report: StormReport }) {
  const magnitude = [report.magnitude, report.units].filter(Boolean).join(" ");
  const office = report.officeId || report.office;
  return (
    <article className={`storm-report-row storm-report-row--${report.source === "Spotter Network" ? "spotter-network" : "nws"} storm-report-row--${report.type.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <div className="storm-report-row__head">
        <div className="storm-report-row__title">
          <strong>{report.type}</strong>
          <span className="storm-report-source">{report.source === "Spotter Network" ? "Spotter" : "NWS"}</span>
        </div>
        <span>{reportAgeText(report.validTime)} - {report.distanceMiles.toFixed(1)} MI</span>
      </div>
      <div className="storm-report-row__place">
        <span>{report.location}{report.state ? `, ${report.state}` : ""}</span>
        {magnitude && <em>{magnitude}</em>}
      </div>
      {report.remarks && <p>{report.remarks}</p>}
      <footer>{report.source === "Spotter Network" ? "Spotter Network" : office ? `NWS ${office}` : "NWS LSR"} - {report.validTimeText || new Date(report.validTime).toLocaleString()}</footer>
    </article>
  );
}
