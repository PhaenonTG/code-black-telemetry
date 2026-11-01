import { useEffect, useRef, useState } from "react";
import { displayTime } from "./types";

type Storm = { id: string; name: string | null; basin: string | null; classification: string | null;
  intensity_kt: number | null; last_update: string | null; freshness: string; advisory_url: string | null };
type Area = { key: string; basin: string | null; title: string; issued_at: string | null;
  source_url: string | null; chance_48h: number | null; chance_7d: number | null };
type Discovery = { status: string; freshness: string; checked_at: string | null; active_storms: Storm[]; outlook_areas: Area[] };

const url = import.meta.env.DEV ? "/api/tropical-discovery" : "https://ops.codeblackwx.com/api/public/tropical-discovery";
const basinNames: Record<string, string> = { atlantic: "Atlantic", eastern_pacific: "East Pacific", central_pacific: "Central Pacific" };
const kinds: Record<string, string> = { HU: "Hurricane", TS: "Tropical storm", TD: "Depression", PTC: "Post-tropical cyclone", PT: "Post-tropical cyclone", EX: "Extratropical cyclone" };
const basin = (name: string | null) => basinNames[name ?? ""] ?? "NHC basin";
const kind = (code: string | null) => kinds[code ?? ""] ?? "Cyclone";

export default function BasinWatch({ currentStormId }: { currentStormId: string | null }) {
  const [data, setData] = useState<Discovery | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const reveal = () => { if (window.location.hash === "#basin-watch" && detailsRef.current) detailsRef.current.open = true; };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("Discovery unavailable");
        const result = await response.json() as Discovery;
        if (active) { setData(result); setState("ready"); }
      } catch { if (active) setState("unavailable"); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const otherStorms = data?.active_storms.filter((storm) => storm.id !== currentStormId) ?? [];
  const stale = data?.freshness !== "current" || !data.checked_at || Date.now() - Date.parse(data.checked_at) > 45 * 60_000;
  return <section className="basin-watch" id="basin-watch" aria-label="NHC basin watch">
    <details ref={detailsRef}><summary><span><b>BASIN WATCH</b><small>NHC discovery</small></span><strong>{state === "loading" ? "CHECKING" : state === "unavailable" ? "UNAVAILABLE" : `${data?.active_storms.length ?? 0} ACTIVE · ${data?.outlook_areas.length ?? 0} OUTLOOK`}</strong><i aria-hidden="true">⌄</i></summary>
      <div className="basin-watch__body">
        {state === "unavailable" && <p className="basin-watch__warning">Discovery feed unavailable. <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">Check NHC ↗</a></p>}
        {state === "ready" && <>
          <p className="basin-watch__time">Checked {displayTime(data?.checked_at)} · {stale || data?.status !== "ready" ? "Source may be stale — verify with NHC" : "NHC sources current"}</p>
          <div className="basin-watch__columns"><div><h3>Active cyclones</h3>{otherStorms.length ? <ul>{otherStorms.map((storm) => <li key={storm.id}><div><span>{basin(storm.basin)} · {storm.id.toUpperCase()}</span><a className="basin-watch__storm-link" href={`/storms/${storm.id}`}><strong>{kind(storm.classification)} {storm.name}</strong></a><small>{storm.intensity_kt == null ? "Wind unavailable" : `${Math.round(storm.intensity_kt * 1.15078)} mph`} · NHC {displayTime(storm.last_update)}{storm.freshness !== "current" ? " · STALE" : ""}</small></div>{storm.advisory_url && <a href={storm.advisory_url} target="_blank" rel="noreferrer" aria-label={`NHC advisory for ${storm.name ?? storm.id}`}>NHC ↗</a>}</li>)}</ul> : <p>No other active NHC cyclone in this feed.</p>}</div>
          <div><h3>Development outlook</h3>{data?.outlook_areas.length ? <ul>{data.outlook_areas.map((area) => <li key={area.key}><div><span>{basin(area.basin)} · NHC outlook</span><strong>{area.title}</strong><small>Formation: 48h {area.chance_48h == null ? "—" : `${area.chance_48h}%`} · 7d {area.chance_7d == null ? "—" : `${area.chance_7d}%`}</small><small>Issued {displayTime(area.issued_at)}</small></div>{area.source_url && <a href={area.source_url} target="_blank" rel="noreferrer" aria-label={`NHC outlook for ${area.title}`}>NHC ↗</a>}</li>)}</ul> : <p>No development area listed in the latest NHC outlooks.</p>}</div></div>
          <p className="basin-watch__caution">Outlook chances are formation potential, not a forecast track. This bay shows official NHC status only; Aegis has not analyzed these systems.</p>
        </>}
      </div>
    </details>
  </section>;
}
