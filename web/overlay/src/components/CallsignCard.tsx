import { useEffect, useRef, useState } from "react";
import { readLiveConfig } from "../config/liveConfig";
import { resolvePublicIdentity } from "../stormIntel/publicIdentity";
import { presentFreshness } from "../utils/freshness";
import { formatHeading } from "../utils/format";
import type { OverlayState } from "../stormIntel/types";
import "./CallsignCard.css";

// Read once, same pattern as store.ts's own module-level config read -- publicIdentity/
// vehicleTag are operator-facing config (?publicIdentity=Nick&vehicleTag=Tessa), never
// expected to change without a page reload.
const config = readLiveConfig();
const displayName = resolvePublicIdentity(config.publicIdentity);
const vehicleTag = config.vehicleTag?.trim() || null;

// The personal-identity moment the original Nick Mounce overlay had that this chassis lost --
// "it said exactly who it was". Bold name treatment, bottom-left, own chase-vehicle callsign
// underneath. Freshness dot reuses the same classes/one-shot-flash rule CommandRail's status
// dot uses -- no invented second color language, no continuous pulsing (brand rule).
export function CallsignCard({ state }: { state: OverlayState }) {
  const overallFreshness = presentFreshness(state.snapshot.metrics[0]?.freshness ?? "unknown");
  const heading = state.snapshot.context.location.headingDeg;
  const location = state.publicLocation;
  const [flash, setFlash] = useState(false);
  const prev = useRef(overallFreshness.className);

  useEffect(() => {
    if (prev.current !== overallFreshness.className) {
      prev.current = overallFreshness.className;
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 1900);
      return () => clearTimeout(timer);
    }
  }, [overallFreshness.className]);

  return (
    <div className="callsign-card cb-chassis">
      <div className="callsign-card__name-row">
        <span className={`callsign-card__dot ${overallFreshness.className}${flash ? " cb-flash-once" : ""}`} />
        <span className="callsign-card__name">{displayName}</span>
      </div>
      {vehicleTag && (
        <div className="callsign-card__tag">
          <span className="callsign-card__tag-label">UNIT</span>
          <span className="callsign-card__tag-value cb-mono">{vehicleTag}</span>
        </div>
      )}
      <div className="callsign-card__telemetry">
        <span className="callsign-card__location">{location ? `${location.city}, ${location.state}` : "LOCATION UNAVAILABLE"}</span>
        <span className="callsign-card__heading cb-mono">
          {heading !== null ? `${formatHeading(heading)} ${Math.round(heading)}°` : "HEADING --"}
        </span>
      </div>
    </div>
  );
}
