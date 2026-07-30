import { useGps } from "../../hooks/useTelemetry";
import { valueText } from "../../services/telemetry/quality";
import { DashCard } from "../ui/DashCard";
import { MetricRow } from "../ui/MetricRow";

export function GpsCard({ className }: { className?: string }) {
  const gps = useGps();
  if (!gps) return null;

  const sats = gps.satellites ?? 0;

  return (
    <DashCard title="GPS" className={className}>
      <div className="flex items-end gap-3 mb-3">
        <div>
          <span className="font-mono text-4xl font-bold text-white tabular-nums">{valueText(gps.speedMph, 1)}</span>
          <span className="text-cb-muted text-xs ml-1 font-mono">mph</span>
        </div>
        <span className={`mb-1 font-mono text-sm font-semibold ${gps.hasFix ? "text-cb-green" : "text-cb-red"}`}>
          {gps.hasFix ? "FIX" : "NO FIX"}
        </span>
      </div>
      <MetricRow label="Heading" value={`${valueText(gps.headingDeg, 0)} deg`} />
      <MetricRow label="Satellites" value={gps.satellites ?? "--"} status={sats < 4 ? "critical" : sats < 6 ? "warn" : "ok"} />
      <MetricRow label="Lat / Lon" value={`${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`} status="muted" />
    </DashCard>
  );
}
