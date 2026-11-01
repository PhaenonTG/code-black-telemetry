import type { PublicHurricane } from "./types";
import { ageLabel } from "./forecastTime";
import { displayTime } from "./types";

const mph = (metersPerSecond: number | null) => metersPerSecond == null ? "—" : `${Math.round(metersPerSecond * 2.23694)} mph`;
const coordinate = (value: number, positive: string, negative: string) => `${Math.abs(value).toFixed(2)}°${value < 0 ? negative : positive}`;
const stationName: Record<string, string> = { "42001": "Mid Gulf", "42012": "Orange Beach", "42039": "Pensacola offshore", PCLF1: "Pensacola coast" };

export default function Observations({ data }: { data: PublicHurricane }) {
  const observations = data.observations;
  const recon = observations?.recon;
  const fixes = observations?.aircraft_fixes ?? [];
  const stations = observations?.maritime ?? [];
  return <section className="observations" id="observations" aria-label="Aircraft and surface observations">
    <details className="evidence-disclosure"><summary><span>Storm evidence</span><strong>Aircraft & surface observations</strong><i aria-hidden="true">⌄</i></summary><div className="evidence-disclosure__body">
    <div className="observations__grid">
      <article className="observation-recon"><div className="observation-card__head"><h3>Hurricane Hunters</h3><a href={recon?.source ?? "https://www.nhc.noaa.gov/recon.php"} target="_blank" rel="noreferrer">NHC source ↗</a></div>
        {recon?.status === "ready" && recon.latitude != null && recon.longitude != null ? <>
          <strong className="observation-recon__position">{coordinate(recon.latitude, "N", "S")} · {coordinate(recon.longitude, "E", "W")}</strong>
          <div className="observation-recon__values"><span>Vortex fix · {displayTime(recon.observed_at)}</span><b>{recon.pressure_mb == null ? "Pressure unavailable" : `${recon.pressure_mb} mb`}</b></div>
          {(recon.eye_characteristic || recon.eye_diameter_nm != null || recon.max_flight_wind_kt != null) && <div className="observation-recon__details">
            <div><span>Eye</span><strong>{recon.eye_characteristic ?? "—"}{recon.eye_diameter_nm == null ? "" : ` · ${recon.eye_diameter_nm} nmi`}</strong></div>
            <div><span>Max flight-level wind</span><strong>{recon.max_flight_wind_kt == null ? "—" : `${recon.max_flight_wind_kt} kt`}</strong></div>
          </div>}
          <small className={Date.now()-Date.parse(recon.observed_at ?? "")>3*3600_000 ? "observation-age--old" : ""}>{ageLabel(recon.observed_at)} · {fixes.length} aircraft fix{fixes.length === 1 ? "" : "es"} recorded</small>
          {fixes.length > 1 && <details className="observation-fixes"><summary>Aircraft fix history</summary><ol>{[...fixes].reverse().slice(0, 12).map((fix) => <li key={fix.observed_at}><time>{displayTime(fix.observed_at)}</time><span>{coordinate(fix.latitude, "N", "S")} · {coordinate(fix.longitude, "E", "W")}</span><b>{fix.pressure_mb == null ? "—" : `${fix.pressure_mb} mb`}</b></li>)}</ol></details>}
        </> : <p>No current matching aircraft vortex fix. This does not mean the storm is unobserved.</p>}
      </article>
      <article className="observation-marine"><div className="observation-card__head"><h3>Buoys & coastal stations</h3><a href="https://www.ndbc.noaa.gov/" target="_blank" rel="noreferrer">NDBC ↗</a></div>
        {stations.length ? <div className="observation-stations">{stations.map((station) => <div className="observation-station" key={station.station}>
          <div><strong>{station.station}</strong><small>{stationName[station.station] ?? "NDBC station"}</small><span title={displayTime(station.observed_at)} className={Date.now()-Date.parse(station.observed_at ?? "")>90*60_000 ? "observation-age--old" : ""}>{station.status === "ready" ? ageLabel(station.observed_at) : station.status === "stale" ? "Stale reading" : "Unavailable"}</span></div>
          <div><span>Wind / gust</span><strong>{station.status === "ready" ? `${mph(station.wind_m_s)} / ${mph(station.gust_m_s)}` : "—"}</strong></div>
          <div><span>Pressure</span><strong>{station.status === "ready" && station.pressure_hpa != null ? `${station.pressure_hpa.toFixed(1)} mb` : "—"}</strong>{station.status === "ready" && station.pressure_change_3h_hpa != null && <small className={station.pressure_change_3h_hpa < 0 ? "observation-pressure--falling" : "observation-pressure--rising"}>{station.pressure_change_3h_hpa > 0 ? "+" : ""}{station.pressure_change_3h_hpa} / 3h</small>}</div>
          <a href={station.source} target="_blank" rel="noreferrer" aria-label={`NDBC station ${station.station} source`}>↗</a>
        </div>)}</div> : <p>Station observations are temporarily unavailable.</p>}
      </article>
    </div></div></details>
  </section>;
}
