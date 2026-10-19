import { useEffect, useState } from "react";
import shield from "../assets/codeblack-shield.png";
import type { EventTakeover as EventTakeoverData, EventTakeoverKind } from "../stormIntel/types";
import "./EventTakeover.css";

const KIND_CLASS: Record<EventTakeoverKind, string> = {
  TOR_WARNING: "takeover--tor-warning",
  SVR_WARNING: "takeover--svr-warning",
  MESO_DISCUSSION: "takeover--meso",
  TOR_WATCH: "takeover--tor-watch",
  PDS_TOR_WATCH: "takeover--pds-watch",
  OBSERVED_TORNADO: "takeover--observed",
};

const EXIT_MS = 420;

export function EventTakeover({ takeover }: { takeover: EventTakeoverData | null }) {
  const [rendered, setRendered] = useState<EventTakeoverData | null>(takeover);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (takeover) {
      setRendered(takeover);
      setExiting(false);
      return;
    }
    if (rendered) {
      setExiting(true);
      const timer = setTimeout(() => setRendered(null), EXIT_MS);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeover]);

  if (!rendered) return null;

  return (
    <div
      key={rendered.id}
      className={`takeover ${KIND_CLASS[rendered.kind]}${exiting ? " takeover--exit" : ""}`}
      role="alert"
    >
      <div className="cb-chassis takeover__inner">
        <img src={shield} alt="" className="takeover__bug" aria-hidden="true" />
        <div className="takeover__text">
          <span className="cb-kicker takeover__kicker">CODE BLACK WX</span>
          <span className="takeover__headline">{rendered.headline}</span>
          <span className="takeover__detail">{rendered.detail}</span>
        </div>
        {!exiting && (
          <div className="takeover__bar-track">
            <div className="takeover__bar" style={{ animationDuration: `${rendered.holdMs}ms` }} />
          </div>
        )}
      </div>
    </div>
  );
}
