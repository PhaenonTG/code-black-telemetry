import type { RadarProduct } from "../services/radar";

// Color stops mirror radar-worker/worker.cjs's palette() exactly -- a legend that lies about what
// the colors mean is worse than no legend, so if that function changes, this must change with it.
type Stop = [value: number, rgb: [number, number, number]];

const REF_STOPS: Stop[] = [
  [-10, [10, 14, 18]], [5, [42, 92, 120]], [20, [23, 170, 80]], [35, [235, 210, 33]],
  [45, [255, 122, 20]], [55, [230, 36, 45]], [65, [205, 65, 210]], [80, [255, 255, 255]],
];

// VEL/SRV share the same diverging palette -- blue/cyan is motion toward the radar (inbound),
// red/orange is motion away (outbound); that's the actual signature a chaser is scanning for.
const VEL_STOPS: Stop[] = [
  [-80, [30, 0, 120]], [-45, [35, 80, 235]], [-15, [50, 220, 255]], [0, [16, 16, 16]],
  [15, [255, 230, 80]], [45, [255, 95, 30]], [80, [170, 0, 0]],
];

const CC_BANDS: Array<{ max: number; rgb: [number, number, number]; label: string }> = [
  { max: 0.65, rgb: [230, 50, 55], label: "<0.65 DEBRIS/NON-MET" },
  { max: 0.8, rgb: [245, 210, 60], label: "0.65-0.80" },
  { max: 0.9, rgb: [35, 210, 115], label: "0.80-0.90" },
  { max: 0.96, rgb: [92, 190, 245], label: "0.90-0.96" },
  { max: 1.05, rgb: [210, 220, 225], label: ">0.96 UNIFORM" },
];

function gradientCss(stops: Stop[], min: number, max: number) {
  const span = max - min;
  const parts = stops.map(([value, [r, g, b]]) => `rgb(${r},${g},${b}) ${(((value - min) / span) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

export function radarSwatchCss(product: RadarProduct): string {
  if (product === "CC") return `linear-gradient(90deg, ${CC_BANDS.map((b) => `rgb(${b.rgb.join(",")})`).join(", ")})`;
  if (product === "VEL" || product === "SRV") return gradientCss(VEL_STOPS, -80, 80);
  return gradientCss(REF_STOPS, -10, 80);
}

export function AtlasRadarLegend({ product }: { product: RadarProduct }) {
  if (product === "CC") {
    return (
      <div className="atlas-radar-legend atlas-radar-legend--cc">
        <div className="atlas-radar-legend__bar" style={{ background: radarSwatchCss(product) }} />
        <div className="atlas-radar-legend__labels">
          {CC_BANDS.map((band) => <span key={band.label}>{band.label}</span>)}
        </div>
      </div>
    );
  }
  const isVel = product === "VEL" || product === "SRV";
  return (
    <div className="atlas-radar-legend">
      <div className="atlas-radar-legend__bar" style={{ background: radarSwatchCss(product) }} />
      <div className="atlas-radar-legend__labels">
        {isVel ? (
          <>
            <span>80kt IN</span><span>40</span><span>0</span><span>40</span><span>80kt OUT</span>
          </>
        ) : (
          <>
            <span>-10dBZ</span><span>20</span><span>45</span><span>65</span><span>80dBZ</span>
          </>
        )}
      </div>
    </div>
  );
}
