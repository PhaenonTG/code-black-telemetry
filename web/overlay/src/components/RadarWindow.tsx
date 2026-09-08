import "./RadarWindow.css";

// Frame only -- deliberately does not render radar itself. This project's stated boundary
// (see README.md) is that it renders broadcast graphics only and does not own maps/radar/chase
// tracking; those live in Code Black OPS. In OBS this window's interior stays fully transparent
// so a second browser source (the OPS radar view, positioned/sized to match this frame) shows
// through it, exactly like the original overlay's two-layer composite.
export function RadarWindow() {
  return (
    <div className="radar-window" aria-hidden="true">
      <div className="cb-chassis radar-window__frame">
        <div className="radar-window__head">
          <span className="cb-kicker">RADAR</span>
          <span className="radar-window__live-pill">
            <span className="radar-window__live-dot" />
            LIVE
          </span>
        </div>
        <div className="radar-window__interior" />
      </div>
    </div>
  );
}
