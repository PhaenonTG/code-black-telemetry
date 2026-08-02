import { Panel } from "./Panel";
import { SourceBadge } from "../ui/SourceBadge";
import { useWind } from "../../hooks/useTelemetry";
import { cardinalFromDeg, freshness } from "../../services/telemetry/quality";
import { resolveWindWithFallback } from "../../services/telemetry/fallback";
import { type ExternalObservation } from "../../services/situational";
import type { CockpitMode } from "../../App";
import "./WindCard.css";

export function WindCard({ external, mode }: { external: ExternalObservation | null; mode: CockpitMode }) {
  const wind = useWind();
  const { speed, gust, direction, usingExternal, windSource, identityText } = resolveWindWithFallback(wind, external);
  const cardinal = cardinalFromDeg(direction);
  const stateText = speed !== null && gust == null ? `${identityText} • NO GUST` : identityText;

  return (
    <Panel title="Wind" className={`wind-panel cockpit-card cockpit-card--${mode}`}>
      <div className="wind-hero">
        <div className="wind-hero__item">
          <strong>{speed === null ? "--" : Math.round(speed)}</strong>
          <span>Speed <em>mph</em></span>
        </div>
        <div className="wind-hero__item">
          <strong>{cardinal}</strong>
          <span>Direction <em>{direction == null ? "--" : `${direction.toFixed(0)} deg`}</em></span>
        </div>
      </div>
      <div className="wind-gust-line">
        <span>Gust</span>
        <strong>{gust == null ? "--" : `${Math.round(gust)} mph`}</strong>
      </div>
      <div className="panel-toolbar wind-toolbar">
        <SourceBadge state={usingExternal ? "fallback" : freshness(wind?.updatedAt)}>{windSource}</SourceBadge>
        <span>{stateText}</span>
      </div>
    </Panel>
  );
}
