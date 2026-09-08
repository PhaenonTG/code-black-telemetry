import { useEffect, useRef, useState } from "react";
import shield from "../assets/codeblack-shield.png";
import { readLiveConfig } from "../config/liveConfig";
import { resolvePublicIdentity } from "../stormIntel/publicIdentity";
import { presentFreshness } from "../utils/freshness";
import type { OverlayState } from "../stormIntel/types";
import "./BrandBug.css";

// Read once, same pattern as store.ts's own module-level config read -- publicIdentity is
// operator-facing config (?publicIdentity=Nick), never expected to change without a page reload.
const displayName = resolvePublicIdentity(readLiveConfig().publicIdentity);

// Corner identity mark, now carrying who this feed is (never the internal cbwx-unit-* fleet ID --
// see publicIdentity.ts) alongside the supplied shield mark, and a connection-state dot reusing
// the same freshness classes/one-shot-flash rule CommandRail's status dot uses -- no invented
// second color language, and no continuous pulsing (brand rule, see brand.css).
export function BrandBug({ state }: { state: OverlayState }) {
  const overallFreshness = presentFreshness(state.snapshot.metrics[0]?.freshness ?? "unknown");
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
    <div className="brand-bug cb-chassis" aria-hidden="true">
      <img src={shield} alt="" className="cb-brand-bug" />
      <div className="brand-bug__identity">
        <span className="brand-bug__name">{displayName}</span>
        <span className={`brand-bug__dot ${overallFreshness.className}${flash ? " cb-flash-once" : ""}`} />
      </div>
    </div>
  );
}
