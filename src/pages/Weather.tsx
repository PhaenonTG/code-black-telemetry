import { useWeather } from "../hooks/useTelemetry";
import { valueText } from "../services/telemetry/quality";
import { DashCard } from "../components/ui/DashCard";
import { MetricRow } from "../components/ui/MetricRow";

export function Weather() {
  const wx = useWeather();
  if (!wx) return null;
  const spread = wx.tempF !== null && wx.dewpointF !== null ? wx.tempF - wx.dewpointF : null;
  const humidWarn = (wx.humidity ?? 0) > 85;

  return (
    <div className="cb-scroll flex-1 p-4 grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr", alignContent: "start" }}>
      <DashCard title="Temperature" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-white tabular-nums">{valueText(wx.tempF, 1)}</span>
          <span className="text-cb-muted font-mono text-sm mt-1">deg F</span>
        </div>
      </DashCard>
      <DashCard title="Dewpoint" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className="font-mono text-7xl font-bold text-white tabular-nums">{valueText(wx.dewpointF, 1)}</span>
          <span className="text-cb-muted font-mono text-sm mt-1">deg F</span>
        </div>
      </DashCard>
      <DashCard title="Humidity" accent>
        <div className="flex flex-col items-center justify-center py-4">
          <span className={`font-mono text-7xl font-bold tabular-nums ${humidWarn ? "text-cb-amber" : "text-white"}`}>{valueText(wx.humidity, 0)}</span>
          <span className="text-cb-muted font-mono text-sm mt-1">%</span>
        </div>
      </DashCard>
      <DashCard title="All Readings" className="col-span-3">
        <MetricRow label="Temperature" value={valueText(wx.tempF, 2)} unit="deg F" />
        <MetricRow label="Dewpoint" value={valueText(wx.dewpointF, 2)} unit="deg F" />
        <MetricRow label="Humidity" value={`${valueText(wx.humidity, 1)}%`} status={humidWarn ? "warn" : "ok"} />
        <MetricRow label="Spread" value={valueText(spread, 2)} unit="deg F" status="muted" />
      </DashCard>
    </div>
  );
}
