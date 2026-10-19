import "./SceneFrame.css";

// Quiet corner brackets around the whole canvas -- borrowed from the original Nick Mounce
// overlay's camera-frame corners (the thing that made it read as "you're watching a live feed",
// not just a floating data panel). Purely decorative, pointer-events none, sits behind
// everything else in the z-order.
export function SceneFrame() {
  return (
    <div className="scene-frame" aria-hidden="true">
      <span className="scene-frame__corner scene-frame__corner--tl" />
      <span className="scene-frame__corner scene-frame__corner--tr" />
      <span className="scene-frame__corner scene-frame__corner--bl" />
      <span className="scene-frame__corner scene-frame__corner--br" />
    </div>
  );
}
