import { useMemo } from "react";
import { presentFreshness } from "../utils/freshness";
import type { HodographData, WindProfileLevel } from "../stormIntel/types";
import "./Hodograph.css";

const SIZE = 240;
const CENTER = SIZE / 2;
const RINGS = [20, 40, 60, 80];
const MAX_RADIUS = CENTER - 26;

const BAND_COLOR: Record<WindProfileLevel["band"], string> = {
  surface: "#f4f6f8",
  low: "#42d67d",
  mid: "#f2b84b",
  upper: "#ff3b3b",
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

  return (
    <div className="hodo-card">
      <div className="hodo-card__header">
        <span className="hodo-card__title">HODOGRAPH</span>
        <span className={`hodo-card__fresh ${fresh.className}`}>{fresh.label}</span>
      </div>

      {unavailable ? (
        <div className="hodo-unavailable">Wind profile unavailable</div>
      ) : (
        <>
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
            <line x1={CENTER} y1={8} x2={CENTER} y2={SIZE - 8} className="hodo-axis" />
            <line x1={8} y1={CENTER} x2={SIZE - 8} y2={CENTER} className="hodo-axis" />
            <text x={CENTER + 4} y={16} className="hodo-axis-label">
              N
            </text>

            <path key={pathKey} d={pathD} className="hodo-trace" pathLength={100} />

            {points.map(({ level, point }, i) => (
              <circle
                key={i}
                cx={point.x}
                cy={point.y}
                r={i === 0 ? 4.5 : 3}
                fill={BAND_COLOR[level.band]}
                className="hodo-node"
                style={{ animationDelay: `${300 + i * 140}ms` }}
              />
            ))}
          </svg>

          <div className="hodo-legend">
            <LegendDot band="surface" label="SFC" />
            <LegendDot band="low" label="0-1km" />
            <LegendDot band="mid" label="1-6km" />
            <LegendDot band="upper" label="6-9km" />
          </div>

          <div className="hodo-stats">
            <Stat label="0-1km SRH" value={data.srh01} unit="m²/s²" />
            <Stat label="0-3km SRH" value={data.srh03} unit="m²/s²" />
            <Stat label="0-6km Shear" value={data.shear06} unit="kt" />
          </div>
        </>
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
      <span className="hodo-stat__label">{label}</span>
      <span className="hodo-stat__value">
        {value === null ? "--" : Math.round(value)}
        {value !== null && <span className="hodo-stat__unit">{unit}</span>}
      </span>
    </div>
  );
}
