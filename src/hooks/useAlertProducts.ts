import { useEffect, useRef, useState } from "react";
import { getActiveMesoscaleDiscussions, getNwsAlerts, type AlertProduct } from "../services/situational";
import { emitCodeBlackSound } from "../services/sound";
import { triggerSevereFlash } from "../services/severeFlash";
import { useResumeTick } from "./useResumeTick";

type GpsPoint = { lat: number; lon: number };

const SEVERE_SEVERITIES: AlertProduct["severity"][] = ["tornado", "pds"];

export function useAlertProducts(gps: GpsPoint | null) {
  const [products, setProducts] = useState<AlertProduct[]>([]);
  const [error, setError] = useState("");
  const seenSevereIds = useRef<Set<string>>(new Set());
  const resumeTick = useResumeTick();
  // App.tsx rebuilds its gps object on every telemetry tick (every 1-2s) -- depending on gps
  // directly here tore this effect down and rebuilt it that often too, restarting its 60s interval
  // before it ever elapsed and hammering NWS/SPC with a fresh fetch every couple seconds instead of
  // once a minute. Depending on gps==null instead (only re-creating the effect when a fix is
  // acquired/lost) fixes that, but a storm chaser's position still needs to drive each poll's actual
  // request -- so load() reads the live coordinates from this ref (updated every render) rather than
  // closing over the gps value from whenever the effect last (re)ran.
  const gpsRef = useRef(gps);
  gpsRef.current = gps;

  useEffect(() => {
    if (!gps) return;
    let cancelled = false;
    const load = async () => {
      const currentGps = gpsRef.current;
      if (!currentGps) return;
      try {
        const [alerts, mds] = await Promise.all([getNwsAlerts(currentGps), getActiveMesoscaleDiscussions(currentGps)]);
        if (!cancelled) {
          const next = [...alerts, ...mds].slice(0, 10);
          const currentSevere = next.filter((product) => SEVERE_SEVERITIES.includes(product.severity));
          const newSevere = currentSevere.filter((product) => !seenSevereIds.current.has(product.id));
          if (newSevere.length > 0) {
            emitCodeBlackSound("warning");
            // PDS outranks a plain tornado warning when both are new in the same poll -- flash the
            // more urgent one.
            const toFlash = newSevere.find((product) => product.severity === "pds") ?? newSevere[0];
            triggerSevereFlash(toFlash);
          }
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
  }, [gps == null, resumeTick]);

  return { products, error };
}
