import type { EventTakeover, EventTakeoverKind } from "../stormIntel/types";
import "./AlertRibbon.css";

const RIBBON_CLASS: Record<EventTakeoverKind, string> = {
  TOR_WARNING: "alert-ribbon--tor-warning",
  SVR_WARNING: "alert-ribbon--svr-warning",
  MESO_DISCUSSION: "alert-ribbon--meso",
  TOR_WATCH: "alert-ribbon--tor-watch",
  PDS_TOR_WATCH: "alert-ribbon--pds-watch",
  OBSERVED_TORNADO: "alert-ribbon--observed",
};

// Persistent, full-width reminder strip for whatever EventTakeover last fired -- the big
// full-screen moment (EventTakeover.tsx) is brief by design, but the underlying condition
// (a tornado warning is still in effect) isn't. This is the ongoing, quieter echo of it, sitting
// just above the bottom row for as long as `takeover` stays non-null.
export function AlertRibbon({ takeover }: { takeover: EventTakeover | null }) {
  if (!takeover) return null;
  return (
    <div className={`alert-ribbon ${RIBBON_CLASS[takeover.kind]}`} role="status">
      <span className="alert-ribbon__headline">{takeover.headline}</span>
    </div>
  );
}
