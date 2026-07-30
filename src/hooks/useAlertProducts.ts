import { useEffect, useState } from "react";
import { getActiveMesoscaleDiscussions, getNwsAlerts, type AlertProduct } from "../services/situational";

type GpsPoint = { lat: number; lon: number };

export function useAlertProducts(gps: GpsPoint | null) {
  const [products, setProducts] = useState<AlertProduct[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [alerts, mds] = await Promise.all([getNwsAlerts(gps), getActiveMesoscaleDiscussions(gps)]);
        if (!cancelled) {
          setProducts([...alerts, ...mds].slice(0, 10));
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
