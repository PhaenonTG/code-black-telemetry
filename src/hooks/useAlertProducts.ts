import { useEffect, useRef, useState } from "react";
import { getActiveMesoscaleDiscussions, getNwsAlerts, type AlertProduct } from "../services/situational";
import { emitCodeBlackSound } from "../services/sound";

type GpsPoint = { lat: number; lon: number };

const SEVERE_SEVERITIES: AlertProduct["severity"][] = ["tornado", "pds"];

export function useAlertProducts(gps: GpsPoint | null) {
  const [products, setProducts] = useState<AlertProduct[]>([]);
  const [error, setError] = useState("");
  const seenSevereIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [alerts, mds] = await Promise.all([getNwsAlerts(gps), getActiveMesoscaleDiscussions(gps)]);
        if (!cancelled) {
          const next = [...alerts, ...mds].slice(0, 10);
          const currentSevere = next.filter((product) => SEVERE_SEVERITIES.includes(product.severity));
          const hasNewSevere = currentSevere.some((product) => !seenSevereIds.current.has(product.id));
          if (hasNewSevere) emitCodeBlackSound("warning");
          seenSevereIds.current = new Set(currentSevere.map((product) => product.id));
          setProducts(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Alert fetch failed");
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gps]);

  return { products, error };
}
