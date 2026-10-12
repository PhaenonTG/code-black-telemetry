import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveMesoscaleDiscussions, getNwsAlerts, type AlertProduct } from "../services/situational";
import { emitCodeBlackSound } from "../services/sound";
import { triggerSevereFlash } from "../services/severeFlash";
import { useResumeTick } from "./useResumeTick";

type GpsPoint = { lat: number; lon: number };

const SEVERE_SEVERITIES: AlertProduct["severity"][] = ["severe", "tornado", "pds"];

function soundEventFor(product: AlertProduct) {
  if (product.severity === "pds") return "pds-warning";
  if (product.severity === "tornado") return "tornado-warning";
  return "severe-warning";
}

export function useAlertProducts(gps: GpsPoint | null, requireFresh = false) {
  const [products, setProducts] = useState<AlertProduct[]>([]);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
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
  const hasGps = gps != null;
  const referenceKey = gps ? `${Math.round(gps.lat * 50)},${Math.round(gps.lon * 50)}` : "none";

  useEffect(() => {
    setProducts([]); setCheckedAt(null); setError("");
    if (!hasGps) { setChecking(false); return; }
    let cancelled = false;
    let busy = false;
    let lastNws: AlertProduct[] = [];
    let lastMds: AlertProduct[] = [];
    const load = async () => {
      if (busy) return;
      const currentGps = gpsRef.current;
      if (!currentGps) return;
      busy = true;
      setChecking(true);
      try {
        const [alerts, mds] = await Promise.allSettled([getNwsAlerts(currentGps, requireFresh), getActiveMesoscaleDiscussions(currentGps, requireFresh)]);
        if (!cancelled) {
          if (alerts.status === "fulfilled") lastNws = alerts.value;
          if (mds.status === "fulfilled") lastMds = mds.value;
          const next = [...lastNws, ...lastMds].filter((product) => Date.parse(product.expires) > Date.now()).slice(0, 10);
          const currentSevere = next.filter((product) => SEVERE_SEVERITIES.includes(product.severity));
          const newSevere = currentSevere.filter((product) => !seenSevereIds.current.has(product.id));
          if (newSevere.length > 0) {
            const toFlash =
              newSevere.find((product) => product.severity === "pds") ??
              newSevere.find((product) => product.severity === "tornado") ??
              newSevere[0];
            emitCodeBlackSound(soundEventFor(toFlash));
            triggerSevereFlash(toFlash);
          }
          seenSevereIds.current = new Set(currentSevere.map((product) => product.id));
          setProducts(next);
          setError([alerts.status === "rejected" ? "NWS alerts unavailable" : "", mds.status === "rejected" ? "SPC discussions unavailable" : ""].filter(Boolean).join(" · "));
          if (alerts.status === "fulfilled") setCheckedAt(Date.now());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Alert fetch failed");
      } finally {
        busy = false;
        if (!cancelled) setChecking(false);
      }
    };
    refreshRef.current = () => { void load(); };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      refreshRef.current = () => {};
      window.clearInterval(timer);
    };
  }, [hasGps, referenceKey, resumeTick, requireFresh]);

  return { products, error, checkedAt, checking, refresh };
}
