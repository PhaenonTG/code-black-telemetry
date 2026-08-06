import { useState } from "react";
import { createPortal } from "react-dom";
import { MAX_PIN_SIZE_SCALE, MIN_PIN_SIZE_SCALE, type PinShape } from "../../services/settings";

export const PIN_SHAPES: Array<{ shape: PinShape; glyph: string }> = [
  { shape: "circle", glyph: "●" },
  { shape: "diamond", glyph: "◆" },
  { shape: "triangle", glyph: "▲" },
  { shape: "star", glyph: "★" },
  { shape: "square", glyph: "■" },
];

// Curated so the native color wheel isn't the only option -- picked for contrast against the map's
// dark base style and against each other (a Team/Chaser pair should read as two different groups
// at a glance, not just two shades of the same hue). No blue, matching this app's established
// red/white/black + amber (+ these accent) palette rule.
export const PIN_COLOR_PRESETS = ["#3ddc70", "#ffbe3c", "#f2f2f2", "#b26bff", "#ff5fa8", "#ff8a3d", "#ff2d35", "#d4ff3d"];

export interface SimplePinStyle {
  color: string;
  shape: PinShape;
  sizeScale: number;
}

function shapeClipPath(shape: PinShape): string {
  if (shape === "diamond") return "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
  if (shape === "triangle") return "polygon(50% 0%, 100% 100%, 0% 100%)";
  if (shape === "star") return "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)";
  return "";
}

// A small static preview of the current style -- the thing that's always visible, standing in for
// what used to be the entire always-expanded picker. Tapping it is the only way to reach the actual
// controls now, which is the point: the picker itself only exists while you're changing something.
export function PinStylePreview({ style, size = 22 }: { style: SimplePinStyle; size?: number }) {
  return (
    <span
      className="pin-style-preview"
      style={{
        width: size,
        height: size,
        background: style.color,
        borderRadius: style.shape === "circle" ? "50%" : style.shape === "square" ? "3px" : 0,
        clipPath: shapeClipPath(style.shape) || undefined,
      }}
      aria-hidden="true"
    />
  );
}

export function PinStyleTrigger({ label, style, onOpen }: { label: string; style: SimplePinStyle; onOpen: () => void }) {
  return (
    <button type="button" className="pin-style-trigger" onClick={onOpen}>
      <PinStylePreview style={style} />
      <span>{label}</span>
    </button>
  );
}

// The picker itself: color wheel + presets + shape + size, all behind the trigger above. Opens as a
// modal rather than an inline popover -- this gets used from the Layers page (Team/Chasers rows) and
// Settings (Vehicle), both of which are already dense pages where an always-there or even
// hover-anchored popover would either not fit or fight for the same space this was built to save.
export function PinStyleModal({
  title,
  style,
  onChange,
  onClose,
}: {
  title: string;
  style: SimplePinStyle;
  onChange: (style: SimplePinStyle) => void;
  onClose: () => void;
}) {
  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="product-modal pin-style-modal">
        <div className="modal-head">
          <div>
            <div className="cb-panel__title">Pin Style</div>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Done">X</button>
        </div>
        <div className="modal-scroll pin-style-modal__body">
          <div className="settings-pin-control">
            <input type="color" value={style.color} onChange={(event) => onChange({ ...style, color: event.target.value })} />
            <div className="settings-color-presets" aria-label={`${title} color presets`}>
              {PIN_COLOR_PRESETS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={style.color.toLowerCase() === hex ? "active" : ""}
                  style={{ background: hex }}
                  aria-label={`Use ${hex}`}
                  onClick={() => onChange({ ...style, color: hex })}
                />
              ))}
            </div>
            <div className="settings-shape-row" aria-label={`${title} shape`}>
              {PIN_SHAPES.map(({ shape, glyph }) => (
                <button key={shape} type="button" className={style.shape === shape ? "active" : ""} onClick={() => onChange({ ...style, shape })}>{glyph}</button>
              ))}
            </div>
            <div className="settings-size-control" aria-label={`${title} size`}>
              <input
                type="range"
                min={MIN_PIN_SIZE_SCALE}
                max={MAX_PIN_SIZE_SCALE}
                step={0.1}
                value={style.sizeScale}
                onChange={(event) => onChange({ ...style, sizeScale: Number(event.target.value) })}
              />
              <span>{Math.round(style.sizeScale * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Bundles trigger + modal + open state so callers (LayerConfigPage, SettingsPage) don't each
// reimplement "is the picker open" local state.
export function PinStyleField({ label, style, onChange }: { label: string; style: SimplePinStyle; onChange: (style: SimplePinStyle) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PinStyleTrigger label={label} style={style} onOpen={() => setOpen(true)} />
      {open && <PinStyleModal title={label} style={style} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}
