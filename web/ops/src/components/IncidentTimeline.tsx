import type { AlertProduct } from "../../../../src/services/situational";
import type { RoadConditionEvent } from "../../../../src/services/mapLayerModels";
import type { StormReport } from "../../../../src/services/stormReports";
import { useEffect, useState } from "react";

type Entry = { id: string; at: number; type: string; title: string; detail: string; road?: RoadConditionEvent; alert?: AlertProduct; report?: StormReport };
function timeAgo(at: number, now: number) { const minutes = Math.max(0, Math.round((now - at) / 60_000)); return minutes < 60 ? `${minutes}M` : `${Math.round(minutes / 60)}H`; }

export function IncidentTimeline({ alerts, roads, reports, onRoad, onAlert, onReport }: { alerts: AlertProduct[]; roads: RoadConditionEvent[]; reports: StormReport[]; onRoad: (road: RoadConditionEvent) => void; onAlert: (alert: AlertProduct) => void; onReport: (report: StormReport) => void }) {
  // Was `useState(Date.now)` -- captured once at mount and never updated. On a dashboard meant to
  // stay open for hours (this is exactly that), an alert/road/report arriving after mount showed
  // "0M ago" forever (now-at went negative, clamped to 0), and the 6-hour recency cutoff below was
  // measured from page-load time instead of wall-clock time. Ticks the same way StatusBar/
  // CameraWall already do elsewhere in this app.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const entries: Entry[] = [
    ...alerts.map((alert) => ({ id: `alert-${alert.id}`, at: Date.parse(alert.sent) || now, type: "WARNING", title: alert.title, detail: alert.area, alert })),
    ...roads.map((road) => ({ id: `road-${road.id}`, at: road.updatedAt, type: "ROAD", title: road.title, detail: road.roadway ?? road.status, road })),
    ...reports.map((report) => ({ id: `report-${report.id}`, at: report.validTime, type: "REPORT", title: report.type, detail: report.location, report })),
  ].filter((entry) => now - entry.at < 6 * 60 * 60_000).sort((a, b) => b.at - a.at).slice(0, 12);
  return <section className="incident-timeline"><header><span>WHAT CHANGED NEARBY</span><b>{entries.length} CURRENT</b></header>{entries.length === 0 ? <p>No recent warnings, road changes, or storm reports.</p> : <div>{entries.map((entry) => <button type="button" key={entry.id} onClick={() => entry.road ? onRoad(entry.road) : entry.alert ? onAlert(entry.alert) : entry.report && onReport(entry.report)}><span>{entry.type} · {timeAgo(entry.at, now)}</span><b>{entry.title}</b><small>{entry.detail}</small></button>)}</div>}</section>;
}
