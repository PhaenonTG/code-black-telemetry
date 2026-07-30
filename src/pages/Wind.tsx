import { useWind } from "../hooks/useTelemetry";
import { cardinalFromDeg, valueText } from "../services/telemetry/quality";
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
  const cardinal = wind.directionCardinal || cardinalFromDeg(wind.directionDeg);

  return (
    <div className="cb-scroll flex-1 p-4 grid gap-4" style={{ gridTemplateColumns: "1fr 1fr", alignContent: "start" }}>
      <DashCard title="Wind Speed" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-white tabular-nums">{valueText(wind.speedMph, 1)}</span>
          <span className="text-cb-muted font-mono text-sm mt-1">mph</span>
        </div>
      </DashCard>
      <DashCard title="Wind Direction" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-cb-blue">{cardinal}</span>
          <span className="text-cb-muted font-mono text-sm mt-1">{valueText(wind.directionDeg, 1)} deg</span>
        </div>
      </DashCard>
      <DashCard title="Details" className="col-span-2">
        <MetricRow label="Speed" value={valueText(wind.speedMph, 2)} unit="mph" status={windStatus(wind.speedMph ?? 0)} />
        <MetricRow label="Gust" value={valueText(wind.gustMph, 2)} unit="mph" status={windStatus(wind.gustMph ?? 0)} />
        <MetricRow label="Direction" value={`${valueText(wind.directionDeg, 1)} deg`} />
        <MetricRow label="Cardinal" value={cardinal} />
        <MetricRow label="Data Freshness" value={age < 5 ? "LIVE" : `${age}s ago`} status={age > 30 ? "warn" : "ok"} />
      </DashCard>
    </div>
  );
}
