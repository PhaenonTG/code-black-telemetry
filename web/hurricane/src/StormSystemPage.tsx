import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import codeblackShield from "../../../src/assets/codeblack-shield.png";
import { displayTime } from "./types";
import { basinName, position, stormClass, validStormId, windMph, type StormPoint, type StormSystem } from "./stormSystem";
import "./storm-system.css";

const StormSystemMap = lazy(() => import("./StormSystemMap"));
const tokenUrl = import.meta.env.DEV ? "/api/mapbox-token" : "https://ops.codeblackwx.com/overlay-core/mapbox-token";
const stormId = window.location.pathname.split("/")[2]?.toLowerCase() ?? "";
const systemUrl = import.meta.env.DEV ? `/api/tropical-systems/${stormId}` : `https://ops.codeblackwx.com/api/public/tropical-systems/${stormId}`;

function CenterHistory({ data }: { data: StormSystem }) {
  const reported = data.observed_track?.length ? data.observed_track : data.reported_centers ?? [];
  const points = [...reported].filter((point) => point.valid_time).sort((a, b) => Date.parse(b.valid_time!) - Date.parse(a.valid_time!)).slice(0, 8);
  return <details className="system-disclosure" open><summary>OBSERVED CENTERS <span>{points.length} SHOWN</span></summary>
    {points.length ? <ol className="system-history">{points.map((point, index) => <li key={`${point.valid_time}-${index}`}><time>{displayTime(point.valid_time)}</time><strong>{position(point.latitude, point.longitude)}</strong><small>{point.wind_mph == null ? "NHC position" : `${point.wind_mph} mph · NHC best track`}</small></li>)}</ol>
      : <p className="system-empty">NHC center history has not been published for this storm yet.</p>}
  </details>;
}

function TrackTable({ track }: { track: StormPoint[] }) {
  return <details className="system-disclosure"><summary>NHC FORECAST POSITIONS <span>{track.length} POINTS</span></summary>
    <div className="system-track-table">{track.map((point, index) => <div key={`${point.hour}-${index}`}><span>{point.hour == null ? "—" : `+${point.hour}h`}</span><time>{displayTime(point.valid_time)}</time><strong>{position(point.latitude, point.longitude)}</strong></div>)}</div>
  </details>;
}

const evidenceLabel: Record<string, string> = { nhc_status: "NHC STATUS", nhc_discussion: "NHC DISCUSSION", nhc_track: "NHC TRACK", nhc_best_track: "NHC BEST TRACK", nhc_model_aids: "NHC MODEL AIDS" };
function AegisReview({ data }: { data: StormSystem }) {
  const review = data.analysis;
  return <section className="system-review" aria-labelledby="system-review-title">
    <div className="system-review__head"><div><span>LOCAL MODEL · EXPERIMENTAL</span><h2 id="system-review-title">AEGIS REVIEW</h2></div><strong>{review?.status === "ready" ? displayTime(review.reviewed_at) : review?.status === "stale" ? "SOURCE STALE" : "AWAITING REVIEW"}</strong></div>
    {review?.status === "ready" ? <>
      <p className="system-review__summary">{review.summary}</p>
      <div className="system-review__assessments"><div><span>TRACK</span><p>{review.track_assessment}</p></div><div><span>INTENSITY</span><p>{review.intensity_assessment}</p></div></div>
      <details className="system-review__detail"><summary>CHANGES, UNCERTAINTY & EVIDENCE</summary>
        {review.changes?.length ? <div><h3>SINCE LAST CHECK</h3><ul>{review.changes.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
        {review.uncertainties?.length ? <div><h3>UNCERTAINTY</h3><ul>{review.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
        {review.next_check?.length ? <div><h3>NEXT CHECK</h3><ul>{review.next_check.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
        {review.evidence?.length ? <div><h3>SOURCE BASIS</h3><ul>{review.evidence.map((item, index) => <li key={index}><b>{evidenceLabel[item.source] ?? "SOURCE"}</b> {item.finding}</li>)}</ul></div> : null}
      </details>
    </> : <p className="system-review__pending">{review?.status === "stale" ? "NHC evidence is stale. Confirm the latest advisory before using this review." : review?.status === "withheld" ? "Aegis withheld an interpretation because the available evidence was insufficient. NHC data and map remain available." : review?.status === "unavailable" ? "The local review could not be completed. NHC data and map remain available." : "The local Aegis reviewer is waiting for this storm’s latest evidence. No analysis is shown until it is checked."}</p>}
    <p className="system-review__scope">NHC is official. Aegis interpretation is experimental and does not change the official or Code Black track geometry.</p>
    <details className="system-review__archive"><summary>PRIOR AEGIS REVIEWS <span>{data.prior_reviews?.length ?? 0} ARCHIVED</span></summary>
      {data.prior_reviews?.length ? <ol>{data.prior_reviews.map((past, index) => <li key={`${past.reviewed_at}-${index}`}><details><summary><time>{displayTime(past.reviewed_at)}</time><span>NHC BASIS {displayTime(past.basis_nhc_updated_at)}</span></summary>
        <div className="system-review__archive-body"><p>{past.summary}</p><dl><div><dt>TRACK THEN</dt><dd>{past.track_assessment}</dd></div><div><dt>INTENSITY THEN</dt><dd>{past.intensity_assessment}</dd></div></dl>
          {past.changes?.length ? <><h3>CHANGES NOTED AT THAT CHECK</h3><ul>{past.changes.map((change, changeIndex) => <li key={changeIndex}>{change}</li>)}</ul></> : null}
          <small>Archived interpretation, not a current forecast. Verify with NHC.</small></div>
      </details></li>)}</ol> : <p>No earlier verified run for this storm yet. One appears when new source evidence receives another review.</p>}
    </details>
  </section>;
}

export default function StormSystemPage() {
  const [data, setData] = useState<StormSystem | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [token, setToken] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  useEffect(() => {
    if (!validStormId(stormId)) { setState("error"); return; }
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(systemUrl, { cache: "no-store" });
        if (!response.ok) throw new Error("Storm feed unavailable");
        const next = await response.json() as StormSystem;
        if (active) { setData(next); setState("ready"); }
      } catch { if (active) setState("error"); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let active = true;
    fetch(tokenUrl).then((response) => response.json()).then((body) => {
      if (active && typeof body.token === "string") setToken(body.token);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const stale = useMemo(() => data?.freshness !== "current" || !data.checked_at || Date.now() - Date.parse(data.checked_at) > 2 * 3_600_000, [data]);
  const observed = data?.observed_track?.length ? data.observed_track : data?.reported_centers ?? [];
  const modelCount = data?.guidance?.models.length ?? 0;
  const official = data?.sources?.advisory ?? "https://www.nhc.noaa.gov/";
  return <div className="system-page">
    <header className="system-header"><a className="system-brand" href="/"><img src={codeblackShield} alt=""/><span>CODE BLACK <em>TROPICS</em></span></a><a className="system-header__nhc" href={official} target="_blank" rel="noreferrer">NHC OFFICIAL ↗</a></header>
    <main>
      <a className="system-back" href="/#basin-watch">← BASIN WATCH</a>
      {state === "loading" && <p className="system-state">Loading storm evidence…</p>}
      {state === "error" && <div className="system-state" role="alert"><h1>Storm data unavailable</h1><p>Check the storm ID or open the <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">official NHC site ↗</a>.</p></div>}
      {state === "ready" && data?.status === "pending" && <div className="system-state"><h1>Storm evidence pending</h1><p>NHC lists this system, but its storm-specific track and guidance have not completed ingest. <a href={official} target="_blank" rel="noreferrer">NHC official ↗</a></p></div>}
      {state === "ready" && data && data.status !== "pending" && <>
        <section className="system-nameplate"><div><span>{basinName(data.basin)} · {data.storm_id?.toUpperCase()}</span><h1>{stormClass(data.classification)}<br/><strong>{data.name ?? "Unnamed"}</strong></h1></div><div className="system-nameplate__source"><b>NHC {data.status === "active" ? "ACTIVE" : "HISTORICAL"}</b><time>{displayTime(data.nhc_updated_at)}</time><small>Checked {displayTime(data.checked_at)}</small></div></section>
        {(stale || data.status !== "active") && <p className="system-stale" role="status">{data.status !== "active" ? "Last published storm record. This is not a current forecast." : "Storm source check is stale. Verify the latest advisory with NHC."}</p>}
        <section className="system-readouts" aria-label="Latest NHC measurements"><div><strong>{windMph(data.wind_kt) ?? "—"}<small>mph</small></strong><span>SUSTAINED WIND</span></div><div><strong>{data.pressure_mb ?? "—"}<small>mb</small></strong><span>MINIMUM PRESSURE</span></div><div><strong className="system-readouts__position">{position(data.current_center?.latitude, data.current_center?.longitude)}</strong><span>NHC CENTER</span></div></section>
        <section className="system-track"><div className="system-track__head"><h2>STORM TRACK</h2><span>NHC FORECAST · {displayTime(data.track_issued_at)}</span></div>
          {token && (data.track?.length ?? 0) > 0 ? <Suspense fallback={<div className="system-map system-map--fallback">Loading map…</div>}><StormSystemMap data={data} token={token} selectedModels={selectedModels}/></Suspense>
            : <div className="system-map system-map--fallback">{data.track?.length ? "Map unavailable. Official positions are listed below." : "NHC forecast positions unavailable."}</div>}
          <div className="system-legend"><span><i className="system-legend__nhc"/>NHC OFFICIAL</span><span><i className="system-legend__past"/>NHC OBSERVED</span>{data.projection?.status === "ready" && <span><i className="system-legend__experimental"/>CODE BLACK EXPERIMENTAL</span>}{selectedModels.length > 0 && <span><i className="system-legend__model"/>MODELS</span>}</div>
          <p className="system-track__scope">{data.projection?.status === "ready" ? `Code Black experimental median of ${data.projection.member_ids.length} fresh dynamical tracks. Not an official forecast.` : "Code Black experimental projection pending. NHC is the only forecast track shown."}</p>
        </section>
        <AegisReview data={data}/>
        <div className="system-evidence"><CenterHistory data={data}/><div className="system-evidence__right"><details className="system-disclosure"><summary>MODEL GUIDANCE <span>{modelCount} AVAILABLE</span></summary>
          <p className="system-disclosure__meta">Latest cycle {displayTime(data.guidance?.latest_cycle)}. Model tracks are guidance, not NHC forecasts.</p>
          {modelCount ? <div className="system-models">{data.guidance!.models.map((model) => <label key={model.id}><input type="checkbox" checked={selectedModels.includes(model.id)} onChange={() => setSelectedModels((current) => current.includes(model.id) ? current.filter((id) => id !== model.id) : [...current, model.id])}/><span>{model.name ?? model.id}</span><small>{displayTime(model.cycle)}</small></label>)}</div> : <p className="system-empty">No complete model aid is available.</p>}</details>
          <TrackTable track={data.track ?? []}/>
          <details className="system-disclosure"><summary>SOURCES & METHOD</summary><div className="system-sources"><a href={official} target="_blank" rel="noreferrer">NHC advisory ↗</a>{data.sources?.discussion && <a href={data.sources.discussion} target="_blank" rel="noreferrer">NHC discussion ↗</a>}{data.sources?.track && <a href={data.sources.track} target="_blank" rel="noreferrer">NHC track product ↗</a>}<p>Reported centers and forecast positions are NHC products. Code Black's track median and Aegis interpretation are experimental. The map does not predict impacts at a location.</p></div></details>
        </div></div>
        <footer className="system-footer"><span>CODE BLACK / TROPICS</span><small>{observed.length} NHC center records · {modelCount} model aids</small><a href="/">Main storm desk ↗</a></footer>
      </>}
    </main>
  </div>;
}
