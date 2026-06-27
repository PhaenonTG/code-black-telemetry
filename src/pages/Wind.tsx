import { useWind } from "../hooks/useTelemetry";
import { DashCard } from "../components/ui/DashCard";
import { MetricRow } from "../components/ui/MetricRow";

function windStatus(mph: number): "ok" | "warn" | "critical" {
  if (mph > 50) return "critical";
  if (mph > 30) return "warn";
  return "ok";
}

export function Wind() {
  const wind = useWind();
  if (!wind) return null;

  const age = Math.round((Date.now() - wind.updatedAt) / 1000);

  return (
    <div className="cb-scroll flex-1 p-4 grid gap-4" style={{ gridTemplateColumns: "1fr 1fr", alignContent: "start" }}>
      <DashCard title="Wind Speed" accent className="col-span-1">
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-white tabular-nums">
            {wind.speedMph.toFixed(1)}
          </span>
          <span className="text-cb-muted font-mono text-sm mt-1">mph</span>
        </div>
      </DashCard>

      <DashCard title="Wind Direction" accent className="col-span-1">
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-cb-blue">
            {wind.directionCardinal}
          </span>
          <span className="text-cb-muted font-mono text-sm mt-1">{wind.directionDeg.toFixed(1)}°</span>
        </div>
      </DashCard>

      <DashCard title="Details" className="col-span-2">
        <MetricRow label="Speed"         value={wind.speedMph.toFixed(2)}     unit="mph" status={windStatus(wind.speedMph)} />
        <MetricRow label="Gust"          value={wind.gustMph.toFixed(2)}      unit="mph" status={windStatus(wind.gustMph)} />
        <MetricRow label="Direction"     value={`${wind.directionDeg.toFixed(1)}°`} />
        <MetricRow label="Cardinal"      value={wind.directionCardinal} />
        <MetricRow label="Data Freshness" value={age < 5 ? "LIVE" : `${age}s ago`} status={age > 30 ? "warn" : "ok"} />
      </DashCard>
    </div>
  );
}
