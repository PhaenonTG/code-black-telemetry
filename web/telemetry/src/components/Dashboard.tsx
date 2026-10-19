import { DashboardCard } from "./DashboardCard";
import { Metric } from "./Metric";
import { StatusStrip } from "./StatusStrip";
import { setSimulationMode } from "../telemetry/store";
import type { TelemetrySnapshot } from "../telemetry/types";
import { fixed, freshnessLabel, timeLabel, uptimeLabel } from "../utils/format";

export function Dashboard({ snapshot }: { snapshot: TelemetrySnapshot }) {
  const batteryTone = snapshot.power.mainBatteryV < 12.0 ? "critical" : snapshot.power.mainBatteryV < 12.3 ? "warning" : "normal";
  const storageTone = snapshot.system.storagePercent > 88 ? "critical" : snapshot.system.storagePercent > 76 ? "warning" : "normal";

  return (
    <main className="dashboard-shell">
      <section className="primary-grid" aria-label="Primary telemetry">
        <DashboardCard title="Wind" meta={freshnessLabel(snapshot.wind.updatedAt)}>
          <div className="metric-grid metric-grid--primary">
            <Metric label="Speed" value={fixed(snapshot.wind.speedMph, 1)} unit="mph" tone="accent" />
            <Metric label="Gust" value={fixed(snapshot.wind.gustMph, 1)} unit="mph" tone={snapshot.wind.gustMph > 35 ? "warning" : "normal"} />
            <Metric label="Direction" value={snapshot.wind.directionCardinal} unit={`${Math.round(snapshot.wind.directionDeg)} deg`} />
            <Metric label="Freshness" value={freshnessLabel(snapshot.wind.updatedAt)} tone={snapshot.mode === "live" ? "normal" : "warning"} />
          </div>
        </DashboardCard>

        <DashboardCard title="Weather" meta={freshnessLabel(snapshot.weather.updatedAt)}>
          <div className="metric-grid metric-grid--primary">
            <Metric label="Temperature" value={fixed(snapshot.weather.temperatureF, 1)} unit="F" />
            <Metric label="Dewpoint" value={fixed(snapshot.weather.dewpointF, 1)} unit="F" />
            <Metric label="Humidity" value={fixed(snapshot.weather.humidityPercent)} unit="%" />
          </div>
        </DashboardCard>

        <DashboardCard title="GPS" meta={snapshot.gps.hasFix ? "FIX" : "NO FIX"}>
          <div className="metric-grid metric-grid--primary">
            <Metric label="Speed" value={fixed(snapshot.gps.speedMph, 1)} unit="mph" tone="accent" />
            <Metric label="Heading" value={snapshot.gps.headingCardinal} unit={`${Math.round(snapshot.gps.headingDeg)} deg`} />
            <Metric label="Satellites" value={String(snapshot.gps.satellites)} />
            <Metric label="GPS Fix" value={snapshot.gps.hasFix ? "LOCKED" : "LOST"} tone={snapshot.gps.hasFix ? "normal" : "critical"} />
          </div>
        </DashboardCard>
      </section>

      <StatusStrip snapshot={snapshot} />

      <section className="lower-grid" aria-label="Supporting telemetry">
        <DashboardCard title="Sensor Health">
          <div className="sensor-list">
            {snapshot.sensors.map((sensor) => (
              <div className="sensor-row" key={sensor.id}>
                <div>
                  <strong>{sensor.label}</strong>
                  <span>Last packet {timeLabel(sensor.lastPacketAt)}</span>
                </div>
                <div>
                  <span className="status-pill" data-state={sensor.online ? "online" : "offline"}>{sensor.online ? "ONLINE" : "OFFLINE"}</span>
                  <em>{fixed(sensor.packetRateHz, 1)} Hz</em>
                </div>
              </div>
            ))}
          </div>
        </DashboardCard>

        <DashboardCard title="Power">
          <div className="metric-grid">
            <Metric label="Main battery" value={fixed(snapshot.power.mainBatteryV, 2)} unit="V" tone={batteryTone} />
            <Metric label="Aux battery" value={fixed(snapshot.power.auxBatteryV, 2)} unit="V" />
            <Metric label="Charging" value={snapshot.power.charging ? "YES" : "NO"} tone={snapshot.power.charging ? "accent" : "muted"} />
          </div>
        </DashboardCard>

        <DashboardCard title="System">
          <div className="metric-grid">
            <Metric label="CPU" value={fixed(snapshot.system.cpuPercent)} unit="%" />
            <Metric label="RAM" value={fixed(snapshot.system.memoryPercent)} unit="%" />
            <Metric label="Storage" value={fixed(snapshot.system.storagePercent)} unit="%" tone={storageTone} />
            <Metric label="Uptime" value={uptimeLabel(snapshot.system.uptimeSeconds)} />
          </div>
        </DashboardCard>

        <DashboardCard title="Recent Events" className="events-card">
          <div className="event-log">
            {snapshot.events.map((event) => (
              <div className="event-row" data-level={event.level} key={event.id}>
                <span>{timeLabel(event.timestamp)}</span>
                <strong>{event.level.toUpperCase()}</strong>
                <p>{event.message}</p>
              </div>
            ))}
          </div>
        </DashboardCard>

        <DashboardCard title="Settings" className="settings-card">
          <div className="mode-controls" role="group" aria-label="Telemetry simulation mode">
            {(["live", "stale", "offline"] as const).map((mode) => (
              <button type="button" className={snapshot.mode === mode ? "active" : ""} key={mode} onClick={() => setSimulationMode(mode)}>
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="settings-note">Simulation only. REST and WebSocket providers will attach behind the same telemetry provider interface later.</p>
        </DashboardCard>
      </section>
    </main>
  );
}
