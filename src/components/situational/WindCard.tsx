import { useEffect } from "react";
import { Panel } from "./Panel";
import { SourceBadge } from "../ui/SourceBadge";
import { useWind } from "../../hooks/useTelemetry";
import { usePeakGust } from "../../hooks/usePeakGust";
import { cardinalFromDeg, freshness } from "../../services/telemetry/quality";
import { resolveWindWithFallback } from "../../services/telemetry/fallback";
import { clearPeakGust, recordGustReading } from "../../services/peakGust";
import { type ExternalObservation } from "../../services/situational";
import type { CockpitMode } from "../../App";
import "./WindCard.css";

// NWS criteria: Wind Advisory at gusts 46-57 mph, High Wind Warning / Severe Thunderstorm gust
// criterion at 58+. Text-color only (data-tone, same vocabulary as the GPS/ops status readouts) --
// deliberately not the accent-stripe treatment this card's CSS already rejects.
function windTone(value: number | null): "warn" | "critical" | undefined {
  if (value == null) return undefined;
  if (value >= 58) return "critical";
  if (value >= 46) return "warn";
  return undefined;
}

export function WindCard({ external, mode }: { external: ExternalObservation | null; mode: CockpitMode }) {
  const wind = useWind();
  const { speed, gust, direction, usingExternal, windSource, identityText } = resolveWindWithFallback(wind, external);
  const cardinal = cardinalFromDeg(direction);
  const stateText = speed !== null && gust == null ? `${identityText} • NO GUST` : identityText;
  const speedTone = windTone(gust ?? speed);

  // Shared with the severe report form (services/peakGust.ts), which suggests this value for its
  // Wind Speed field. Session-scoped only (not persisted) — a peak from a prior storm shouldn't
  // linger into today's chase. Tap resets it; a fresh higher reading always overwrites the hold.
  const peakGust = usePeakGust();
  const peakTone = windTone(peakGust);
  useEffect(() => {
    if (gust != null) recordGustReading(gust);
  }, [gust]);

  return (
    <Panel title="Wind" className={`wind-panel cockpit-card cockpit-card--${mode}`}>
      <div className="wind-hero">
        <div className="wind-hero__item wind-hero__item--speed">
          <strong data-tone={speedTone}>{speed === null ? "--" : Math.round(speed)}</strong>
          <span>Speed <em>mph</em></span>
        </div>
        <div className="wind-hero__item wind-hero__item--direction">
          <strong>{cardinal}</strong>
          <span>Direction <em>{direction == null ? "--" : `${direction.toFixed(0)} deg`}</em></span>
        </div>
        <button
          type="button"
          className="wind-hero__item wind-hero__item--peak"
          onClick={() => clearPeakGust()}
          disabled={peakGust == null}
          aria-label="Peak gust, tap to reset"
        >
          <strong data-tone={peakTone}>{peakGust == null ? "--" : Math.round(peakGust)}</strong>
          <span>Peak Gust <em>{gust == null ? "mph" : `now ${Math.round(gust)}`}</em></span>
          {peakGust != null && <i className="wind-hero__reset-hint">Tap to reset</i>}
        </button>
      </div>
      <div className="panel-toolbar wind-toolbar">
        <SourceBadge state={usingExternal ? "fallback" : freshness(wind?.updatedAt)}>{windSource}</SourceBadge>
        <span>{stateText}</span>
      </div>
    </Panel>
  );
}
