import { useEffect, useState } from "react";
import { getPeakGust, subscribePeakGust } from "../services/peakGust";

export function usePeakGust(): number | null {
  const [peakGust, setPeakGust] = useState(() => getPeakGust());
  useEffect(() => subscribePeakGust(setPeakGust), []);
  return peakGust;
}
