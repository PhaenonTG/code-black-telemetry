import { useMemo } from "react";
import type { SoundingProfile } from "../core/types";

// Standard skew-T/log-P transform, simplified to the constants this chart needs -- isobars are
// horizontal (y depends only on pressure), isotherms are the classic 45-degree-ish diagonals
// (x depends on both temperature and height-fraction). This file only draws what Core already
// computed (profile arrays, parcel trace) -- it never derives a meteorological value itself.
const P_TOP = 100;
const P_BOTTOM = 1050;
const T_MIN = -40;
const T_MAX = 45;
const SKEW = 34; // deg of x-shift at the very top of the chart relative to the bottom
const MARGIN = { top: 18, right: 18, bottom: 34, left: 42 };
const CHART_W = 560;
const CHART_H = 520;
const VIEW_W = CHART_W + MARGIN.left + MARGIN.right;
const VIEW_H = CHART_H + MARGIN.top + MARGIN.bottom;
const LOG_TOP = Math.log(P_TOP);
const LOG_BOTTOM = Math.log(P_BOTTOM);
const ISOBAR_LEVELS = [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100];
const ISOTHERM_LEVELS_C = [-40, -30, -20, -10, 0, 10, 20, 30, 40];

function yForPressure(p: number): number {
  const frac = (Math.log(p) - LOG_TOP) / (LOG_BOTTOM - LOG_TOP);
  return MARGIN.top + frac * CHART_H;
}

function heightFracForY(y: number): number {
  return 1 - (y - MARGIN.top) / CHART_H;
}

function xForTemp(tempC: number, y: number): number {
  const skewed = tempC + SKEW * heightFracForY(y);
  return MARGIN.left + ((skewed - T_MIN) / (T_MAX - T_MIN)) * CHART_W;
}

function pathFor(pressures: number[], values: number[]): string {
  const points: string[] = [];
  for (let i = 0; i < pressures.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const y = yForPressure(pressures[i]);
    const x = xForTemp(v, y);
    points.push(`${points.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

export function SkewT({ profile }: { profile: SoundingProfile }) {
  const tempPath = useMemo(() => pathFor(profile.pressure_hpa, profile.temp_c), [profile]);
  const dewpPath = useMemo(() => pathFor(profile.pressure_hpa, profile.dewp_c), [profile]);
  const parcelPath = useMemo(
    () => (profile.parcel_temp_c ? pathFor(profile.pressure_hpa, profile.parcel_temp_c) : null),
    [profile],
  );

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="skewt" role="img" aria-label="Skew-T log-P diagram">
      <rect x={MARGIN.left} y={MARGIN.top} width={CHART_W} height={CHART_H} className="skewt__frame" />

      {/* Isotherms -- skewed diagonals, background reference only */}
      {ISOTHERM_LEVELS_C.map((t) => {
        const yTop = MARGIN.top;
        const yBottom = MARGIN.top + CHART_H;
        return (
          <line
            key={`iso-${t}`}
            x1={xForTemp(t, yTop)}
            y1={yTop}
            x2={xForTemp(t, yBottom)}
            y2={yBottom}
            className={t === 0 ? "skewt__isotherm skewt__isotherm--freezing" : "skewt__isotherm"}
          />
        );
      })}

      {/* Isobars -- horizontal, labeled on the left axis */}
      {ISOBAR_LEVELS.filter((p) => p >= P_TOP && p <= P_BOTTOM).map((p) => {
        const y = yForPressure(p);
        return (
          <g key={`iso-p-${p}`}>
            <line x1={MARGIN.left} y1={y} x2={MARGIN.left + CHART_W} y2={y} className="skewt__isobar" />
            <text x={MARGIN.left - 6} y={y + 3} className="skewt__axis-label skewt__axis-label--p" textAnchor="end">
              {p}
            </text>
          </g>
        );
      })}

      {/* Temperature axis ticks along the bottom */}
      {[-40, -20, 0, 20, 40].map((t) => {
        const y = MARGIN.top + CHART_H;
        const x = xForTemp(t, y);
        return (
          <text key={`tx-${t}`} x={x} y={y + 16} className="skewt__axis-label" textAnchor="middle">
            {t}°C
          </text>
        );
      })}

      {parcelPath && <path d={parcelPath} className="skewt__parcel" fill="none" />}
      <path d={dewpPath} className="skewt__dewpoint" fill="none" />
      <path d={tempPath} className="skewt__temperature" fill="none" />

      <g className="skewt__legend" transform={`translate(${MARGIN.left + 8}, ${MARGIN.top + 10})`}>
        <LegendRow y={0} className="skewt__temperature" label="Temperature" />
        <LegendRow y={14} className="skewt__dewpoint" label="Dewpoint" />
        {parcelPath && <LegendRow y={28} className="skewt__parcel" label="Surface parcel" />}
      </g>
    </svg>
  );
}

function LegendRow({ y, className, label }: { y: number; className: string; label: string }) {
  return (
    <g transform={`translate(0, ${y})`}>
      <line x1={0} y1={5} x2={18} y2={5} className={className} />
      <text x={24} y={9} className="skewt__legend-label">
        {label}
      </text>
    </g>
  );
}
