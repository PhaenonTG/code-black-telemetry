import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { addManualLandmark, addSourceReview, listMapSources, listSourceHistory, loadCurrentReviews, updateSourceLocation, type MapSourceReview, type RegisteredMapSource } from "../lib/mapRegistry";
import type { MapPinStatus, MapSourceKind } from "../../../../src/services/mapSourceRegistry";
import { CAMERA_MAP_SUPPRESSIONS } from "../../../../src/services/cameraMapEligibility";

const KINDS: Array<{ value: string; label: string }> = [
  { value: "all", label: "ALL" }, { value: "camera", label: "CAMERAS" },
  { value: "surface_station", label: "SURFACE OBS" }, { value: "gas", label: "GAS" },
  { value: "lodging", label: "HOTELS" }, { value: "hospital", label: "HOSPITALS" },
  { value: "food", label: "FOOD" }, { value: "landmark", label: "LANDMARKS" },
];
const PAGE_SIZE = 100;

function sourceStatus(source: RegisteredMapSource, review?: MapSourceReview): string {
  if (review) return review.status === "visible" ? "ALLOWED" : review.status === "hidden" ? "HIDDEN" : "ON HOLD";
  if (source.kind === "camera" && CAMERA_MAP_SUPPRESSIONS[source.id.slice("camera:".length)]) return "HIDDEN · LEGACY AUDIT";
  return "UNREVIEWED · ELIGIBLE";
}

function time(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function MapRegistry() {
  const detailRef = useRef<HTMLElement | null>(null);
  const [kind, setKind] = useState("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<RegisteredMapSource[]>([]);
  const [count, setCount] = useState(0);
  const [reviews, setReviews] = useState<Record<string, MapSourceReview>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<MapSourceReview[]>([]);
  const [findings, setFindings] = useState("");
  const [nextReview, setNextReview] = useState("");
  const [edit, setEdit] = useState(false);
  const [metadata, setMetadata] = useState({ name: "", city: "", state: "", latitude: "", longitude: "", address: "" });
  const [createLandmark, setCreateLandmark] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const result = await listMapSources(kind, search, offset);
    setRows(result.rows);
    setCount(result.count);
    setReviews(await loadCurrentReviews(result.rows.map((row) => row.id)));
  }, [kind, search, offset]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void reload().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Registry unavailable"); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [reload]);

  useEffect(() => {
    if (!selectedId) { setHistory([]); return; }
    void listSourceHistory(selectedId).then(setHistory).catch((cause) => setError(cause instanceof Error ? cause.message : "Review history unavailable"));
  }, [selectedId]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const current = selected ? reviews[selected.id] : undefined;

  function choose(row: RegisteredMapSource) {
    setSelectedId(row.id);
    setFindings("");
    setNextReview("");
    setEdit(false);
    setCreateLandmark(false);
    setMetadata({ name: row.name, city: row.city ?? "", state: row.state ?? "", latitude: String(row.latitude), longitude: String(row.longitude), address: row.address ?? "" });
    if (window.matchMedia("(max-width: 800px)").matches) window.setTimeout(() => detailRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }), 0);
  }

  async function review(status: MapPinStatus) {
    if (!selected || findings.trim().length < 3) { setError("Enter a finding of at least three characters."); return; }
    setBusy(true); setError("");
    try {
      await addSourceReview(selected.id, status, findings, nextReview ? new Date(`${nextReview}T12:00:00`).toISOString() : null);
      await reload();
      setHistory(await listSourceHistory(selected.id));
      setFindings("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save review"); }
    finally { setBusy(false); }
  }

  async function saveLocation() {
    if (!selected) return;
    const latitude = Number(metadata.latitude), longitude = Number(metadata.longitude);
    if (!metadata.name.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setError("Enter a name and valid latitude/longitude."); return;
    }
    setBusy(true); setError("");
    try {
      await updateSourceLocation(selected.id, { name: metadata.name.trim(), city: metadata.city.trim() || null, state: metadata.state.trim() || null, latitude, longitude, address: metadata.address.trim() || null });
      await reload(); setEdit(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save location"); }
    finally { setBusy(false); }
  }

  async function saveLandmark() {
    const latitude = Number(metadata.latitude), longitude = Number(metadata.longitude);
    if (!metadata.name.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setError("Enter a name and valid latitude/longitude."); return;
    }
    setBusy(true); setError("");
    try {
      const id = `landmark:manual:${crypto.randomUUID()}`;
      await addManualLandmark({ id, kind: "landmark" as MapSourceKind, provider_id: "codeblack-manual", provider_record_id: id.split(":").pop()!, name: metadata.name.trim(), city: metadata.city.trim() || null, state: metadata.state.trim() || null, latitude, longitude, address: metadata.address.trim() || null, source_url: null, attributes: {} });
      setKind("landmark"); setOffset(0); setCreateLandmark(false); setSelectedId(id);
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add landmark"); }
    finally { setBusy(false); }
  }

  return <div className="page page-map-registry">
    <PageHeader title="MAP SOURCE REGISTRY" kicker="PROVENANCE · REVIEW · PIN STATUS" description="Encountered map sources, operator findings, and pin eligibility. Layer switches and feed health still apply." />
    <div className="map-registry-toolbar">
      <div className="map-registry-kinds" role="group" aria-label="Source type">
        {KINDS.map((item) => <button type="button" key={item.value} className={kind === item.value ? "active" : ""} onClick={() => { setKind(item.value); setOffset(0); setSelectedId(null); }}>{item.label}</button>)}
      </div>
      <input aria-label="Search map sources" placeholder="Search name, city, state, source ID" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
      <button type="button" onClick={() => { setCreateLandmark(true); setSelectedId(null); setMetadata({ name: "", city: "", state: "", latitude: "", longitude: "", address: "" }); }}>+ LANDMARK</button>
    </div>
    {error && <p className="map-registry-error" role="alert">{error}</p>}
    <div className="map-registry-layout">
      <section className="map-registry-list" aria-label="Map sources">
        <header><strong>{count.toLocaleString()} SOURCES</strong><span>Encountered on the OPS map</span></header>
        {rows.length === 0 && <p className="page-empty">No sources in this view. Open a map layer to discover provider records.</p>}
        {rows.map((row) => <button type="button" key={row.id} className={selectedId === row.id ? "map-registry-row active" : "map-registry-row"} onClick={() => choose(row)}>
          <span className="map-registry-row__top"><b>{row.name}</b><em>{row.kind.replace("_", " ")}</em></span>
          <span className="map-registry-row__bottom"><span>{[row.city, row.state].filter(Boolean).join(", ") || row.provider_id}</span><span className={sourceStatus(row, reviews[row.id]).startsWith("HIDDEN") ? "is-hidden" : ""}>{sourceStatus(row, reviews[row.id])}</span></span>
        </button>)}
        {count > PAGE_SIZE && <footer className="map-registry-pages"><button disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setSelectedId(null); }}>PREV</button><span>{offset + 1}–{Math.min(offset + PAGE_SIZE, count)} / {count}</span><button disabled={offset + PAGE_SIZE >= count} onClick={() => { setOffset(offset + PAGE_SIZE); setSelectedId(null); }}>NEXT</button></footer>}
      </section>
      <section ref={detailRef} className="map-registry-detail" aria-label="Source detail">
        {createLandmark ? <>
          <header><span>NEW MANUAL POINT</span><h2>LANDMARK</h2></header>
          <div className="map-registry-form">{locationFields(metadata, setMetadata)}<div className="map-registry-actions"><button disabled={busy} onClick={() => void saveLandmark()}>SAVE LANDMARK</button><button onClick={() => setCreateLandmark(false)}>CANCEL</button></div></div>
        </> : selected ? <>
          <header><span>{selected.kind.replace("_", " ").toUpperCase()} · {selected.provider_id}</span><h2>{selected.name}</h2><p>{selected.id}</p></header>
          <div className="map-registry-facts">
            <div><span>MAP DOT</span><b>{sourceStatus(selected, current)}</b></div>
            <div><span>LOCATION</span><b>{[selected.city, selected.state].filter(Boolean).join(", ") || "Not supplied"}</b></div>
            <div><span>COORDINATES</span><b>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</b></div>
            <div><span>ADDRESS / ROAD</span><b>{selected.address || "—"}</b></div>
            <div><span>LAST SEEN</span><b>{time(selected.last_seen_at)}</b></div>
            <div><span>LAST REVIEW</span><b>{current ? `${current.reviewer_email} · ${time(current.reviewed_at)}` : "Never"}</b></div>
            <div><span>NEXT REVIEW</span><b>{time(current?.next_review_at)}</b></div>
            {Object.entries(selected.attributes ?? {}).filter(([, value]) => value !== null && value !== "").map(([key, value]) => <div key={key}><span>{key.replaceAll("_", " ").toUpperCase()}</span><b>{String(value)}</b></div>)}
          </div>
          <div className="map-registry-links"><a href={`https://www.openstreetmap.org/?mlat=${selected.latitude}&mlon=${selected.longitude}#map=13/${selected.latitude}/${selected.longitude}`} target="_blank" rel="noopener noreferrer">VIEW LOCATION ↗</a>{selected.source_url && /^https?:\/\//i.test(selected.source_url) && <a href={selected.source_url} target="_blank" rel="noopener noreferrer">SOURCE ↗</a>}<button onClick={() => setEdit((value) => !value)}>EDIT LOCATION</button></div>
          {edit && <div className="map-registry-form">{locationFields(metadata, setMetadata)}<div className="map-registry-actions"><button disabled={busy} onClick={() => void saveLocation()}>SAVE LOCATION</button><button onClick={() => setEdit(false)}>CANCEL</button></div></div>}
          <div className="map-registry-review"><h3>NEW REVIEW</h3><textarea aria-label="Review findings" placeholder="What did you verify? View, feed health, station quality, place accuracy…" value={findings} maxLength={4000} onChange={(event) => setFindings(event.target.value)} /><label>NEXT REVIEW <input type="date" value={nextReview} onChange={(event) => setNextReview(event.target.value)} /></label><div className="map-registry-actions"><button disabled={busy} onClick={() => void review("visible")}>ALLOW DOT</button><button disabled={busy} onClick={() => void review("needs_review")}>HOLD FOR REVIEW</button><button disabled={busy} className="danger" onClick={() => void review("hidden")}>HIDE DOT</button></div></div>
          <div className="map-registry-history"><h3>REVIEW HISTORY</h3>{history.length === 0 ? <p>Not yet reviewed.</p> : history.map((item) => <article key={item.id}><header><b>{item.status.replace("_", " ").toUpperCase()}</b><span>{time(item.reviewed_at)} · {item.reviewer_email}</span></header><p>{item.findings}</p></article>)}</div>
        </> : <p className="page-empty">Select a source to inspect its provenance and review history.</p>}
      </section>
    </div>
  </div>;
}

type LocationForm = { name: string; city: string; state: string; latitude: string; longitude: string; address: string };
function locationFields(value: LocationForm, setValue: (next: LocationForm) => void) {
  const field = (key: keyof typeof value, label: string) => <label key={key}>{label}<input value={value[key]} onChange={(event) => setValue({ ...value, [key]: event.target.value })} /></label>;
  return <div className="map-registry-fields">{field("name", "NAME")}{field("city", "CITY")}{field("state", "STATE")}{field("latitude", "LATITUDE")}{field("longitude", "LONGITUDE")}{field("address", "ADDRESS / ROAD")}</div>;
}
