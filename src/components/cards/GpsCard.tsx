import { useGps } from "../../hooks/useTelemetry";
import { DashCard } from "../ui/DashCard";
import { MetricRow } from "../ui/MetricRow";

export function GpsCard({ className }: { className?: string }) {
  const gps = useGps();
  if (!gps) return null;

  return (
    <DashCard title="GPS" className={className}>
      <div className="flex items-end gap-3 mb-3">
        <div>
          <span className="font-mono text-4xl font-bold text-white tabular-nums">
            {gps.speedMph.toFixed(1)}
          </span>
          <span className="text-cb-muted text-xs ml-1 font-mono">mph</span>
        </div>
        <span className={`mb-1 font-mono text-sm font-semibold ${gps.hasFix ? "text-cb-green" : "text-cb-red"}`}>
          {gps.hasFix ? "FIX" : "NO FIX"}
        </span>
      </div>
      <MetricRow label="Heading"    value={`${gps.headingDeg.toFixed(0)}°`} />
      <MetricRow label="Satellites" value={gps.satellites} status={gps.satellites < 4 ? "critical" : gps.satellites < 6 ? "warn" : "ok"} />
      <MetricRow label="Lat / Lon"  value={`${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`} status="muted" />
    </DashCard>
  );
}
