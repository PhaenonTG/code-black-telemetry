import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalogMatchesPanel } from "../components/AnalogMatchesPanel";
import { Hodograph } from "../components/Hodograph";
import { OpsStatusPill } from "../components/OpsStatusPill";
import { SkewT } from "../components/SkewT";
import { browserLocationAdapter, type LocationState } from "../adapters";
import { fetchSoundingPoint, searchSoundingLocation, OpsCoreClientError } from "../core/client";
import { useCoreOps } from "../core/useCoreOps";
import type { OpsConnectionState, SoundingPointResult, SoundingRequestState } from "../core/types";

const RECENT_KEY = "codeblack.ops.soundings.recent-locations.v1";
const MAX_RECENT = 6;
// A sounding is a full HRRR fetch + derive on Core -- same generous "still real, not hung" ceiling
// as the point-intel lookup, past which we call it stale rather than keep waiting silently.
const STALE_AFTER_MS = 6 * 60 * 1000;

interface RecentLocation {
  label: string;
  lat: number;
  lon: number;
  savedAt: number;
}

function loadRecent(): RecentLocation[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: RecentLocation[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // localStorage unavailable (private mode, quota) -- recent list just doesn't persist
  }
}

function fabricUnitPoint(units: unknown, unitId: string): { lat: number; lon: number } | null {
  if (typeof units !== "object" || units === null) return null;
  const list = (units as { units?: unknown }).units;
  if (!Array.isArray(list)) return null;
  const unit = list.find((u) => typeof u === "object" && u !== null && (u as { unit_id?: unknown }).unit_id === unitId);
  if (!unit) return null;
  const location = (unit as { location?: unknown }).location;
  if (typeof location !== "object" || location === null) return null;
  const lat = (location as Record<string, unknown>).latitude;
  const lon = (location as Record<string, unknown>).longitude;
  if (typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon };
  }
  return null;
}

function formatUtc(iso: string | null | undefined): string {
  if (!iso) return "UNAVAILABLE";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "UNAVAILABLE";
  return `${date.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

function dataAgeLabel(generatedAt: string | null | undefined): string {
  if (!generatedAt) return "UNKNOWN";
  const ms = Date.now() - new Date(generatedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "UNKNOWN";
  if (ms < 60_000) return "JUST NOW";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m AGO`;
  return `${Math.round(ms / 3_600_000)}h AGO`;
}

// Fixed priority order for the fast-read parameter cards -- operationally useful values already
// supported by the canonical service. Anything Core doesn't return for this profile is simply
// absent from `derived`, never rendered as a fabricated N/A placeholder value.
const PRIORITY_PARAM_KEYS = [
  "sbcape", "sbcin", "mlcape", "mlcin", "mucape", "mucin",
  "lcl_height",
  "shear_0_1km", "shear_0_6km",
  "srh_0_1km_calc", "srh_0_3km_calc",
  "bunkers_rm", "bunkers_lm",
  "critical_angle",
  "pwat",
  "lapse_0_3km", "lapse_700_500",
  "freezing_level",
];

export default function SoundingsWorkspace() {
  const { config, state } = useCoreOps();
  const [gps, setGps] = useState<LocationState>({ status: "requesting" });
  const [point, setPoint] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [result, setResult] = useState<SoundingPointResult | null>(null);
  // "idle" -- not "CHECKING" -- until a sounding request has actually been made. Root cause of a
  // real production bug: this used to default to a fetch-in-flight-shaped state (OpsConnectionState
  // has no true "nothing requested yet" value), so a workspace that never made a request, or a
  // search that failed before ever calling loadSounding, both rendered "Loading sounding..."
  // forever -- indistinguishable from a real hang.
  const [phase, setPhase] = useState<SoundingRequestState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [recent, setRecent] = useState<RecentLocation[]>(() => loadRecent());
  const [cityInput, setCityInput] = useState("");
  const [stateInput, setStateInput] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserLocationAdapter.getCurrent().then((s) => {
      if (!cancelled) setGps(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSounding = useCallback(
    async (target: { lat: number; lon: number; label: string }) => {
      setPhase("loading");
      setError(null);
      try {
        const sounding = await fetchSoundingPoint(config, target, { locationName: target.label });
        setResult(sounding);
        setPhase("ready");
        setLoadedAt(Date.now());
        setRecent((prev) => {
          const next = [
            { label: target.label, lat: target.lat, lon: target.lon, savedAt: Date.now() },
            ...prev.filter((r) => !(Math.abs(r.lat - target.lat) < 0.001 && Math.abs(r.lon - target.lon) < 0.001)),
          ].slice(0, MAX_RECENT);
          saveRecent(next);
          return next;
        });
      } catch (err) {
        // Location resolution already succeeded (that's how loadSounding got called at all) --
        // this is specifically a sounding-generation failure, a distinct state from a failed
        // location search (which never reaches here; see handleSearch's own catch).
        setResult(null);
        setPhase("unavailable");
        setError(err instanceof OpsCoreClientError ? err.message : "Sounding request failed.");
      }
    },
    [config],
  );

  const selectPoint = useCallback(
    (next: { lat: number; lon: number; label: string }) => {
      setPoint(next);
      void loadSounding(next);
    },
    [loadSounding],
  );

  useEffect(() => {
    // Auto-becomes stale rather than silently continuing to show an old sounding as current.
    if (phase !== "ready" || loadedAt === null) return;
    const timer = window.setTimeout(() => setPhase("stale"), STALE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [phase, loadedAt]);

  const strikerPoint = useMemo(() => fabricUnitPoint(state.fabric.units, "cbwx-unit-striker"), [state.fabric.units]);
  const tessaPoint = useMemo(() => fabricUnitPoint(state.fabric.units, "cbwx-unit-tessa"), [state.fabric.units]);

  const handleSearch = useCallback(async () => {
    if (!cityInput.trim() || !stateInput.trim()) return;
    setSearchBusy(true);
    setSearchError(null);
    // Clear any stale result/phase from a previous point before this search resolves -- a fresh
    // search attempt should never leave a prior failure (or prior sounding) showing behind it
    // while this one is in flight or if it fails before ever reaching loadSounding.
    setPoint(null);
    setResult(null);
    setPhase("idle");
    try {
      const found = await searchSoundingLocation(config, cityInput.trim(), stateInput.trim());
      selectPoint({ lat: found.latitude, lon: found.longitude, label: found.display_name });
    } catch (err) {
      // Location search itself failed -- never reaches loadSounding, so `phase` stays "idle"
      // (never "loading") and the main workspace shows "select a location" underneath this
      // concise, retryable error rather than a stuck spinner. The entered city/state remain in
      // the inputs (never cleared) so retry is a single click after fixing a typo, or an
      // immediate retry as-is if the failure was transient (e.g. upstream 502).
      setSearchError(err instanceof OpsCoreClientError ? err.message : "Location search failed.");
    } finally {
      setSearchBusy(false);
    }
  }, [cityInput, stateInput, config, selectPoint]);

  const derivedEntries = useMemo(() => {
    if (!result) return [];
    return PRIORITY_PARAM_KEYS.filter((key) => key in result.derived).map((key) => [key, result.derived[key]] as const);
  }, [result]);

  return (
    <div className="soundings-workspace">
      <aside className="soundings-sidebar">
        <section className="soundings-panel">
          <header className="soundings-panel__header">
            <h2>Location</h2>
          </header>
          <div className="soundings-location-form">
            <input
              placeholder="City"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            />
            <input
              placeholder="ST"
              maxLength={2}
              value={stateInput}
              onChange={(e) => setStateInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            />
            <button type="button" onClick={() => void handleSearch()} disabled={searchBusy}>
              {searchBusy ? "…" : "Search"}
            </button>
          </div>
          {searchError && <p className="soundings-panel__error">{searchError}</p>}

          <div className="soundings-quick-locations">
            <button
              type="button"
              disabled={gps.status !== "ready"}
              onClick={() => gps.status === "ready" && selectPoint({ lat: gps.lat, lon: gps.lon, label: "Current device" })}
            >
              Current device
            </button>
            <button type="button" disabled={!strikerPoint} onClick={() => strikerPoint && selectPoint({ ...strikerPoint, label: "STRIKER" })}>
              STRIKER {strikerPoint ? "" : "(unavailable)"}
            </button>
            <button type="button" disabled={!tessaPoint} onClick={() => tessaPoint && selectPoint({ ...tessaPoint, label: "TESSA" })}>
              TESSA {tessaPoint ? "" : "(unavailable)"}
            </button>
          </div>

          {recent.length > 0 && (
            <div className="soundings-recent">
              <span className="soundings-panel__eyebrow">Recent</span>
              {recent.map((r) => (
                <button key={`${r.lat}-${r.lon}`} type="button" onClick={() => selectPoint({ lat: r.lat, lon: r.lon, label: r.label })}>
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="soundings-panel">
          <header className="soundings-panel__header">
            <h2>Model / Time</h2>
          </header>
          <dl className="soundings-status-grid">
            <dt>Model</dt>
            <dd>{result?.model ?? "HRRR"}</dd>
            <dt>Run</dt>
            <dd>{result ? formatUtc(result.run_time) : "—"}</dd>
            <dt>Forecast hour</dt>
            <dd>{result ? `F${result.forecast_hour.toString().padStart(2, "0")}` : "—"}</dd>
            <dt>Valid time</dt>
            <dd>{result ? formatUtc(result.valid_time) : "—"}</dd>
            <dt>Data age</dt>
            <dd>{result ? dataAgeLabel(result.generated_at) : "—"}</dd>
            <dt>Source</dt>
            <dd>NOAA/NCEP NOMADS (local acquisition)</dd>
          </dl>
          <p className="soundings-panel__note">RAP/RRFS are reserved but not yet acquired by this service.</p>
        </section>
      </aside>

      <main className="soundings-main">
        <div className="soundings-status-bar">
          {phase !== "idle" && <OpsStatusPill state={pillStateFor(phase)} label={statusLabel(phase, error)} />}
          <span className="soundings-status-bar__point">{point ? point.label : "No location selected"}</span>
        </div>

        {phase === "idle" && <div className="soundings-empty">Select a location to load a sounding.</div>}
        {phase === "loading" && !result && <div className="soundings-empty">Loading sounding…</div>}
        {phase === "unavailable" && (
          <div className="soundings-empty soundings-empty--error">
            {error ?? "Sounding unavailable."}
            {point && (
              <button type="button" className="soundings-retry" onClick={() => void loadSounding(point)}>
                Retry
              </button>
            )}
          </div>
        )}

        {result && (
          <>
            <div className="soundings-charts">
              <div className="soundings-chart-block">
                <h3>Skew-T / Log-P</h3>
                <SkewT profile={result.profile} />
              </div>
              <div className="soundings-chart-block">
                <h3>Hodograph</h3>
                <Hodograph points={result.hodograph_points} />
              </div>
            </div>

            <section className="soundings-panel">
              <header className="soundings-panel__header">
                <h2>Fast-Read Parameters</h2>
              </header>
              <div className="soundings-params-grid">
                {derivedEntries.map(([key, param]) => (
                  <div key={key} className="soundings-param-card" data-provenance={param.provenance}>
                    <span className="soundings-param-card__label">{param.label}</span>
                    <span className="soundings-param-card__value">
                      {param.value ?? "—"}
                      {param.unit ? ` ${param.unit}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="soundings-panel">
              <header className="soundings-panel__header">
                <h2>Profile Levels</h2>
              </header>
              <div className="soundings-profile-table-wrap">
                <table className="soundings-profile-table">
                  <thead>
                    <tr>
                      <th>hPa</th>
                      <th>m</th>
                      <th>T °C</th>
                      <th>Td °C</th>
                      <th>Wind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.profile.pressure_hpa.map((p, i) => {
                      const u = result.profile.u_ms[i];
                      const v = result.profile.v_ms[i];
                      const speedKt = Math.round(Math.hypot(u, v) * 1.94384);
                      const dirDeg = Math.round((270 - (Math.atan2(v, u) * 180) / Math.PI) % 360);
                      return (
                        <tr key={p}>
                          <td>{p}</td>
                          <td>{Math.round(result.profile.height_m[i])}</td>
                          <td>{result.profile.temp_c[i].toFixed(1)}</td>
                          <td>{result.profile.dewp_c[i].toFixed(1)}</td>
                          <td>
                            {dirDeg}° {speedKt}kt
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <AnalogMatchesPanel />
          </>
        )}
      </main>
    </div>
  );
}

// Maps this workspace's own request-lifecycle state to the shared OpsStatusPill vocabulary.
// "idle" has no sensible mapping (it means "no request made," not a connectivity assessment) --
// callers must not render the pill at all in that phase, matching every call site below.
function pillStateFor(phase: SoundingRequestState): OpsConnectionState {
  switch (phase) {
    case "loading":
      return "CHECKING";
    case "ready":
      return "LIVE";
    case "stale":
      return "STALE";
    case "unavailable":
      return "UNAVAILABLE";
    case "degraded":
      return "DEGRADED";
    case "idle":
      return "UNAVAILABLE";
  }
}

function statusLabel(phase: SoundingRequestState, error: string | null): string {
  if (phase === "unavailable") return error ? `UNAVAILABLE — ${error}` : "UNAVAILABLE";
  return pillStateFor(phase);
}
