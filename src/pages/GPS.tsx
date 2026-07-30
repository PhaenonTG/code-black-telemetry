import { useGps } from "../hooks/useTelemetry";
import { valueText } from "../services/telemetry/quality";
import { DashCard } from "../components/ui/DashCard";
import { MetricRow } from "../components/ui/MetricRow";

export function GPS() {
  const gps = useGps();
  if (!gps) return null;
  const sats = gps.satellites ?? 0;

  return (
    <div className="cb-scroll flex-1 p-4 grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr", alignContent: "start" }}>
      <DashCard title="Speed" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-white tabular-nums">{valueText(gps.speedMph, 1)}</span>
          <span className="text-cb-muted font-mono text-sm mt-1">mph</span>
        </div>
      </DashCard>
      <DashCard title="Heading" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-cb-blue tabular-nums">{valueText(gps.headingDeg, 0)}</span>
          <span className="text-cb-muted font-mono text-sm mt-1">degrees</span>
        </div>
      </DashCard>
      <DashCard title="Fix Status" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className={`font-mono text-4xl font-bold ${gps.hasFix ? "text-cb-green" : "text-cb-red"}`}>{gps.hasFix ? "FIXED" : "NO FIX"}</span>
          <span className="text-cb-muted font-mono text-sm mt-2">{gps.satellites ?? "--"} satellites</span>
        </div>
      </DashCard>
      <DashCard title="Position & Details" className="col-span-3">
        <MetricRow label="Latitude" value={gps.lat.toFixed(6)} status="muted" />
        <MetricRow label="Longitude" value={gps.lon.toFixed(6)} status="muted" />
        <MetricRow label="Speed" value={valueText(gps.speedMph, 2)} unit="mph" />
        <MetricRow label="Heading" value={`${valueText(gps.headingDeg, 1)} deg`} />
        <MetricRow label="Satellites" value={gps.satellites ?? "--"} status={sats < 4 ? "critical" : sats < 6 ? "warn" : "ok"} />
        <MetricRow label="GPS Fix" value={gps.hasFix ? "YES" : "NO"} status={gps.hasFix ? "ok" : "critical"} />
      </DashCard>
    </div>
  );
}
