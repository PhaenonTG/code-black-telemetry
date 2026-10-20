import { useEffect, useState } from "react"
import type { FabricDeviceState, FabricUnitState } from "../../../../src/services/fabric/types"
import { vehicleWeather, type Metric } from "./vehicleWeatherModel"
import "./VehicleWeather.css"

type Props = { units: FabricUnitState[]; selectedId: string; onSelect: (id: string) => void; receivedAt: number | null; connected: boolean; transportLabel?: string; demo?: boolean; now?: number }
const READOUT_IDS = ["temperature_c", "humidity_pct", "pressure_hpa", "speed_mps", "dewpoint_c", "heading_deg", "trunk_temperature_c", "wind_avg_mps"] as const
const valueText = (metric?: Metric) => metric?.value == null ? "—" : metric.value.toFixed(metric.id === "pressure_hpa" || metric.id === "humidity_pct" || metric.unit === "°" ? 0 : 1)
const clock = (time: number | null) => time === null ? "Unknown" : new Date(time).toISOString().slice(11, 19) + " UTC"
function age(time: number | null, now: number) { return time === null ? "Time unknown" : time > now ? "Clock ahead" : `${Math.floor((now - time) / 1000)}s ago` }

function Dial({ metric }: { metric: Metric }) {
  const current = metric.state === "CURRENT", angle = metric.value == null ? null : Math.min(80, metric.value) / 80 * 270 - 135
  return <svg className="vehicle-dial" viewBox="0 0 320 290" aria-hidden="true">
    <circle cx="160" cy="160" r="130" fill="none" stroke="currentColor" opacity=".12" />
    {Array.from({ length: 81 }, (_, index) => {
      const radians = (index / 80 * 270 - 225) * Math.PI / 180, major = index % 10 === 0
      return <line key={index} x1={160 + Math.cos(radians) * (major ? 111 : 118)} y1={160 + Math.sin(radians) * (major ? 111 : 118)} x2={160 + Math.cos(radians) * 128} y2={160 + Math.sin(radians) * 128} className={metric.value !== null && index <= metric.value && current ? "is-filled" : ""} strokeWidth={major ? 3 : 2} />
    })}
    {[0, 20, 40, 60, 80].map((label, index) => {
      const radians = (index / 4 * 270 - 225) * Math.PI / 180
      return <text key={label} x={160 + Math.cos(radians) * 145} y={165 + Math.sin(radians) * 145} textAnchor="middle">{label}</text>
    })}
    {angle !== null && <g className={current ? "vehicle-needle is-current" : "vehicle-needle"} style={{ transform: `rotate(${angle}deg)`, transformOrigin: "160px 160px" }}><path d="M157 46 L163 46 L160 65 Z" fill="currentColor" /></g>}
  </svg>
}

function Readout({ metric }: { metric: Metric }) {
  return <article className="vehicle-reading" data-state={metric.state} data-metric={metric.id}>
    <h3>{metric.label}</h3><p className="vehicle-value" key={`${metric.value}-${metric.state}`}><strong>{valueText(metric)}</strong><span>{metric.unit}</span></p>
    <small>{metric.state === "CURRENT" ? "Current" : metric.state === "UNAVAILABLE" ? "Not available" : metric.state.toLowerCase()}</small>
  </article>
}

function deviceState(device: FabricDeviceState) {
  if (device.connected === false) return "Disconnected"
  if (device.health_state === "STALE") return "Stale"
  if (device.connected === true) return "Connected"
  return device.health_state?.toLowerCase().replaceAll("_", " ") || "Health unknown"
}

export function VehicleWeather({ units, selectedId, onSelect, receivedAt, connected, transportLabel = "Shared Fabric snapshot", demo = false, now: suppliedNow }: Props) {
  const [clockNow, setClockNow] = useState(Date.now)
  useEffect(() => { if (suppliedNow !== undefined) return; const timer = window.setInterval(() => setClockNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [suppliedNow])
  const now = suppliedNow ?? Math.max(clockNow, receivedAt ?? clockNow), view = vehicleWeather(units, selectedId, now, receivedAt, connected)
  const metric = (id: string) => view.metrics.find(value => value.id === id)!
  const wind = metric("wind_mps"), gust = metric("gust_mps"), direction = metric("wind_direction_deg")
  const currentCount = view.metrics.filter(value => value.state === "CURRENT").length
  const anyValues = view.metrics.some(value => value.value !== null)
  const status = !connected ? "OFFLINE" : currentCount ? "CURRENT SAMPLE" : anyValues ? "STALE SAMPLE" : "AWAITING READINGS"
  const choices = units.filter(unit => unit.unit_type === "chase-platform").filter((unit, index, rows) => rows.findIndex(row => row.unit_id === unit.unit_id) === index)
  const devices = view.unit?.devices.filter(device => device.unit_id === selectedId) ?? []
  return <div className="vehicle-hud" data-current={currentCount > 0 && connected}>
    <header className="vehicle-brand">
      <div className="vehicle-brand__mark"><strong>CODE BLACK <i>///</i></strong><p>Live vehicle sensors</p></div>
      <h1>Vehicle weather</h1>
      <span>PRIVATE OPS</span>
    </header>
    {demo && <div className="vehicle-demo" role="note">DEMO FIXTURES <span>Synthetic data · not a live vehicle feed</span></div>}
    <section className="vehicle-controlbar" aria-label="Vehicle weather source">
      <label htmlFor="vehicle-chaser">Chaser<select id="vehicle-chaser" value={selectedId} onChange={event => onSelect(event.target.value)}>
        <option value="">Choose a chaser</option>{selectedId && !choices.some(unit => unit.unit_id === selectedId) && <option value={selectedId}>Selected chaser unavailable</option>}
        {choices.map(unit => <option key={unit.unit_id} value={unit.unit_id}>{unit.operator_name || unit.display_name} · {unit.display_name}</option>)}
      </select></label>
      <div className="vehicle-unit"><span>Unit</span><strong>{view.unit?.display_name || "—"}</strong></div>
      <div className="vehicle-operator"><span>Operator</span><strong>{view.unit?.operator_name || "—"}</strong></div>
      <div className="vehicle-status" role="status" data-state={status}><i /><div><strong>{status}</strong><span>{currentCount}/{view.metrics.length} current</span></div></div>
    </section>
    {view.reason && <p className="vehicle-notice">{view.reason}</p>}
    <div className="vehicle-layout">
      <section className="vehicle-wind" data-state={wind.state} aria-label="Vehicle apparent wind">
        <header><h2>Wind conditions</h2><span>ON VEHICLE</span></header>
        <div className="vehicle-gauge"><Dial metric={wind} /><div className="vehicle-gauge-value"><span>APPARENT WIND</span><strong className="vehicle-value" key={`${selectedId}-${wind.value}-${wind.state}`}>{valueText(wind)}</strong><small>mph</small><p>{wind.state === "CURRENT" ? "Current observation" : wind.value !== null ? "Last observation · " + wind.state.toLowerCase() : "Not reported by this vehicle"}</p></div></div>
        <div className="vehicle-wind-sub"><div><span>Gust</span><strong>{valueText(gust)} <small>mph</small></strong><em>{gust.state.toLowerCase()}</em></div><div><span>Direction</span><strong>{valueText(direction)} <small>°</small></strong><em>{direction.state.toLowerCase()}</em></div></div>
        <p className="vehicle-footnote">Apparent wind reflects motion around the vehicle, not corrected ambient wind.</p>
      </section>
      <section className="vehicle-conditions" aria-label="Selected vehicle conditions">
        <header><h2>Current conditions</h2><span>{currentCount}/{view.metrics.length} CURRENT</span></header>
        <div className="vehicle-readouts" key={selectedId}>{READOUT_IDS.map(id => <Readout key={id} metric={metric(id)} />)}</div>
      </section>
      <section className="vehicle-source"><header><h2>Source integrity</h2><span>{demo ? "Fixture data" : connected ? "Fabric connected" : "Connection unavailable"}</span></header>
        <div className="vehicle-source-state" data-connected={connected}><i /><strong>{demo ? "Fixture data" : connected ? "Fabric connected" : "Fabric unavailable"}</strong></div>
        <ul className="vehicle-devices">{devices.map(device => <li key={device.device_id} data-connected={device.connected !== false}><i /><div><strong>{device.display_label}</strong><span>{deviceState(device)}</span></div></li>)}</ul>
        <div className="vehicle-provenance"><p>Vehicle observations only. No station fallback. Rain is not in the inspected sensor contract.</p>
          <p>{demo ? "Manual fixture samples" : transportLabel}. A reading is current for 3 seconds after observation. Older samples stay visibly stale.</p>
          <dl><div><dt>Browser receipt</dt><dd>{clock(receivedAt)} · {age(receivedAt, now)}</dd></div><div><dt>Per-sensor Core receipt</dt><dd>Not exposed in this snapshot</dd></div></dl>
        </div>
        <details><summary>Reading diagnostics</summary><ul>{view.metrics.map(value => <li key={value.id}><strong>{value.label} · {value.state}</strong><span>{value.deviceId || "No sensor source"}</span><span>Observed {clock(value.observedAt)} · {age(value.observedAt, now)}</span><span>Calibration {value.calibration.toLowerCase()} · {value.reason}</span></li>)}</ul></details>
      </section>
    </div>
  </div>
}
