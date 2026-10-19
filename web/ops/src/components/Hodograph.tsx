import { useMemo } from "react";
import type { SoundingHodographPoint } from "../core/types";

const MS_TO_KT = 1.94384;
const SIZE = 420;
const CENTER = SIZE / 2;
const RING_STEP_KT = 20;
const HEIGHT_STOPS_KM = [1, 3, 6, 9];

// Renders wind vectors Core already computed (u/v per level) as a polar hodograph. Pure
// plotting -- no shear/SRH/storm-motion math happens here, those numbers come from Core's
// derived parameters and are rendered in the params table, not recomputed on this chart.
export function Hodograph({ points }: { points: SoundingHodographPoint[] }) {
  const { path, markers, maxSpeedKt } = useMemo(() => {
    const sorted = [...points].sort((a, b) => a.height_m - b.height_m).filter((p) => p.height_m / 1000 <= 12);
    let maxSpeed = RING_STEP_KT;
    for (const p of sorted) {
      const speed = Math.hypot(p.u_ms, p.v_ms) * MS_TO_KT;
      if (speed > maxSpeed) maxSpeed = speed;
    }
    const ringMax = Math.max(RING_STEP_KT, Math.ceil((maxSpeed + 10) / RING_STEP_KT) * RING_STEP_KT);
    const scale = (CENTER - 30) / ringMax;
    const toXY = (uMs: number, vMs: number) => ({
      x: CENTER + uMs * MS_TO_KT * scale,
      y: CENTER - vMs * MS_TO_KT * scale,
    });
    const segments = sorted.map((p) => `${toXY(p.u_ms, p.v_ms).x.toFixed(1)},${toXY(p.u_ms, p.v_ms).y.toFixed(1)}`);
    const markerPoints = HEIGHT_STOPS_KM.map((km) => {
      // nearest level to this height stop, for a labeled marker along the trace
      let nearest = sorted[0];
      let bestDiff = Infinity;
      for (const p of sorted) {
        const diff = Math.abs(p.height_m / 1000 - km);
        if (diff < bestDiff) {
          bestDiff = diff;
          nearest = p;
        }
      }
      if (!nearest || bestDiff > 1.5) return null;
      const { x, y } = toXY(nearest.u_ms, nearest.v_ms);
      return { km, x, y };
    }).filter((m): m is { km: number; x: number; y: number } => m !== null);
    return { path: `M${segments.join(" L")}`, markers: markerPoints, maxSpeedKt: ringMax };
  }, [points]);

  const rings = useMemo(() => {
    const out: number[] = [];
    for (let r = RING_STEP_KT; r <= maxSpeedKt; r += RING_STEP_KT) out.push(r);
    return out;
  }, [maxSpeedKt]);
  const scale = (CENTER - 30) / maxSpeedKt;

  if (points.length === 0) {
    return <div className="hodograph hodograph--empty">No wind profile available</div>;
  }

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="hodograph" role="img" aria-label="Hodograph">
      {rings.map((r) => (
        <circle key={r} cx={CENTER} cy={CENTER} r={r * scale} className="hodograph__ring" />
      ))}
      {rings.map((r) => (
        <text key={`label-${r}`} x={CENTER + r * scale + 3} y={CENTER - 3} className="hodograph__ring-label">
          {r}kt
        </text>
      ))}
      <line x1={0} y1={CENTER} x2={SIZE} y2={CENTER} className="hodograph__axis" />
      <line x1={CENTER} y1={0} x2={CENTER} y2={SIZE} className="hodograph__axis" />

      <path d={path} className="hodograph__trace" fill="none" />
      {markers.map((m) => (
        <g key={m.km}>
          <circle cx={m.x} cy={m.y} r={4} className="hodograph__marker" />
          <text x={m.x + 6} y={m.y - 6} className="hodograph__marker-label">
            {m.km}km
          </text>
        </g>
      ))}
    </svg>
  );
}
