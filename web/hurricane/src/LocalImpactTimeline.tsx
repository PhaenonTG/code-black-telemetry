import type { PointAlert } from "./watchLocation";

const extract = (description: string, label: string): string | null => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = description.match(new RegExp(`^\\s*-\\s*${escaped}:\\s*([^\\n]*(?:\\n(?!\\s*[-*])[^\\n]*)*)`, "im"));
  return match?.[1]?.replace(/\s+/g, " ").trim() || null;
};

export default function LocalImpactTimeline({ alerts }: { alerts: PointAlert[] }) {
  const warning = alerts.find(alert => /^(hurricane|tropical storm) warning$/i.test(alert.event) && alert.description);
  if (!warning?.description) return null;
  const rows = [
    ["Wind", extract(warning.description, "Peak Wind Forecast")],
    ["Wind window", extract(warning.description, "Window for Tropical Storm force winds")],
    ["Surge", extract(warning.description, "Peak Storm Surge Inundation")],
    ["Surge window", extract(warning.description, "Window of concern")],
  ].filter((row): row is [string, string] => !!row[1]);
  if (!rows.length) return null;
  return <div className="local-impact-timeline" aria-label="NWS point warning impact details">
    <div className="local-impact-timeline__head"><strong>Official local impact windows</strong><a href={warning.url ?? "https://www.weather.gov/"} target="_blank" rel="noreferrer">NWS warning ↗</a></div>
    <div className="local-impact-timeline__rows">{rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <small>From the current NWS warning for this selected point. Surge values apply only in surge-prone areas; not an address-level inundation forecast.</small>
  </div>;
}
