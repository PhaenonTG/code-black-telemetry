import { useMemo, useState } from "react";
import { presentFreshness } from "../utils/freshness";
import type { HodographData, WindProfileLevel } from "../stormIntel/types";
import "./Hodograph.css";

const SIZE = 120;
const CENTER = SIZE / 2;
const RINGS = [20, 40, 60, 80];
const MAX_RADIUS = CENTER - 14;

const BAND_COLOR: Record<WindProfileLevel["band"], string> = {
  surface: "#ffffff",
  low: "#8d949b",
  mid: "#ffcc00",
  upper: "#ff2a0c",
};

function toPoint(level: WindProfileLevel): { x: number; y: number } {
  const rad = (level.directionDeg * Math.PI) / 180;
  const u = -level.speedKt * Math.sin(rad);
  const v = -level.speedKt * Math.cos(rad);
  const scale = MAX_RADIUS / (RINGS[RINGS.length - 1]);
  return { x: CENTER + u * scale, y: CENTER - v * scale };
}

export function Hodograph({ data }: { data: HodographData }) {
  const points = useMemo(() => data.levels.map((level) => ({ level, point: toPoint(level) })), [data.levels]);
  const pathD = useMemo(() => {
    if (points.length === 0) return "";
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.point.x.toFixed(1)} ${p.point.y.toFixed(1)}`).join(" ");
  }, [points]);
  const pathKey = `${data.simulation ? "sim" : "live"}-${points.length}-${points[0]?.point.x ?? 0}`;

  const fresh = presentFreshness(data.freshness);
  const unavailable = points.length === 0;

  // Per-node stagger is a JS-computed inline delay -- CSS custom properties can't collapse it,
  // so reduced-motion is honored explicitly here instead.
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  return (
    <div className="cb-chassis hodo-module">
      <div className="hodo-module__header">
        <span className="cb-kicker">HODOGRAPH</span>
        <span className={`hodo-module__fresh ${fresh.className}`}>{fresh.label}</span>
      </div>

      {unavailable ? (
        <div className="hodo-unavailable">Wind profile unavailable</div>
      ) : (
        <div className="hodo-module__body">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="hodo-svg" role="img" aria-label="Hodograph">
            {RINGS.map((ring) => (
              <circle
                key={ring}
                cx={CENTER}
                cy={CENTER}
                r={(ring / RINGS[RINGS.length - 1]) * MAX_RADIUS}
                className="hodo-ring"
              />
            ))}
            <line x1={CENTER} y1={4} x2={CENTER} y2={SIZE - 4} className="hodo-axis" />
            <line x1={4} y1={CENTER} x2={SIZE - 4} y2={CENTER} className="hodo-axis" />
            <text x={CENTER + 3} y={11} className="hodo-axis-label">
              N
            </text>

            <path key={pathKey} d={pathD} className="hodo-trace" pathLength={100} />

            {points.map(({ level, point }, i) => (
              <circle
                key={i}
                cx={point.x}
                cy={point.y}
                r={i === 0 ? 3.5 : 2.4}
                fill={BAND_COLOR[level.band]}
                className="hodo-node"
                style={{ animationDelay: reducedMotion ? "0ms" : `${300 + i * 140}ms` }}
              />
            ))}
          </svg>

          <div className="hodo-module__data">
            <div className="hodo-legend">
              <LegendDot band="surface" label="SFC" />
              <LegendDot band="low" label="0-1KM" />
              <LegendDot band="mid" label="1-6KM" />
              <LegendDot band="upper" label="6-9KM" />
            </div>

            <div className="hodo-stats">
              <Stat label="0-1KM SRH" value={data.srh01} unit="m²/s²" />
              <Stat label="0-3KM SRH" value={data.srh03} unit="m²/s²" />
              <Stat label="0-6KM SHEAR" value={data.shear06} unit="kt" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendDot({ band, label }: { band: WindProfileLevel["band"]; label: string }) {
  return (
    <span className="hodo-legend__item">
      <span className="hodo-legend__swatch" style={{ background: BAND_COLOR[band] }} />
      {label}
    </span>
  );
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="hodo-stat">
      <span className="cb-label">{label}</span>
      <span className="hodo-stat__value cb-mono">
        {value === null ? "--" : Math.round(value)}
        {value !== null && <span className="hodo-stat__unit">{unit}</span>}
      </span>
    </div>
  );
}
