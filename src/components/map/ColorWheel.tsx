import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Small, dependency-free HSV color wheel: an outer hue ring (drag to rotate) plus an inner
// saturation/value square (drag to pick), with a hex field for direct entry. Built in-house rather
// than adding a color-picker package -- this app has zero UI-library dependencies beyond
// React/Zustand, and this keeps the picker under our own CSS instead of a third-party look.

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return [h, s, v];
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const num = parseInt(match[1], 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(clamp01(n / 255) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const WHEEL_SIZE = 168;
const RING_THICKNESS = 20;
const HOLE_SIZE = WHEEL_SIZE - RING_THICKNESS * 2;
// Deliberately smaller than the exact inscribed-square ratio (~0.707) so the SV square's corners
// sit well inside the ring's hole with real margin, rather than right at the edge -- avoids any
// risk of the square visually poking past the ring.
const SV_SIZE = Math.round(HOLE_SIZE * 0.66);

function angleToHue(dx: number, dy: number): number {
  // atan2(dy, dx) measures clockwise from the 3-o'clock position (screen y is down); the ring's
  // conic-gradient starts its 0deg at 12-o'clock, so shift by +90deg to align pointer angle with
  // the gradient's own angle convention.
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (raw + 90 + 360) % 360;
}

export function ColorWheel({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...(hexToRgb(value) ?? [255, 255, 255])));
  const [hexInput, setHexInput] = useState(value);
  const ringRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"hue" | "sv" | null>(null);
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;

  // External value changes (e.g. switching which pin's style is being edited) resync internal
  // state; internal drags are the source of truth for their own gesture rather than being
  // re-derived from the value prop on every render, which would fight the drag.
  useEffect(() => {
    const rgb = hexToRgb(value);
    if (!rgb) return;
    setHsv(rgbToHsv(...rgb));
    setHexInput(value);
  }, [value]);

  const commit = useCallback(
    (next: [number, number, number]) => {
      setHsv(next);
      const hex = rgbToHex(...hsvToRgb(...next));
      setHexInput(hex);
      onChange(hex);
    },
    [onChange],
  );

  const handleHuePointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = ringRef.current?.getBoundingClientRect();
      if (!rect) return;
      const hue = angleToHue(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
      commit([hue, hsvRef.current[1], hsvRef.current[2]]);
    },
    [commit],
  );

  const handleSvPointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svRef.current?.getBoundingClientRect();
      if (!rect) return;
      const s = clamp01((clientX - rect.left) / rect.width);
      const v = clamp01(1 - (clientY - rect.top) / rect.height);
      commit([hsvRef.current[0], s, v]);
    },
    [commit],
  );

  useEffect(() => {
    function onMove(event: PointerEvent) {
      if (draggingRef.current === "hue") handleHuePointer(event.clientX, event.clientY);
      else if (draggingRef.current === "sv") handleSvPointer(event.clientX, event.clientY);
    }
    function onUp() {
      draggingRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [handleHuePointer, handleSvPointer]);

  const [hue, sat, val] = hsv;
  const ringHandleAngleRad = ((hue - 90) * Math.PI) / 180;
  const ringHandleRadius = (WHEEL_SIZE - RING_THICKNESS) / 2;
  const ringHandleX = WHEEL_SIZE / 2 + ringHandleRadius * Math.cos(ringHandleAngleRad);
  const ringHandleY = WHEEL_SIZE / 2 + ringHandleRadius * Math.sin(ringHandleAngleRad);
  const pureHueHex = rgbToHex(...hsvToRgb(hue, 1, 1));

  return (
    <div className="color-wheel">
      <div
        ref={ringRef}
        className="color-wheel__ring"
        style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
        onPointerDown={(event) => {
          draggingRef.current = "hue";
          handleHuePointer(event.clientX, event.clientY);
        }}
      >
        <div className="color-wheel__hole" style={{ width: HOLE_SIZE, height: HOLE_SIZE }} />
        <div className="color-wheel__handle" style={{ left: ringHandleX, top: ringHandleY }} aria-hidden="true" />
        <div
          ref={svRef}
          className="color-wheel__sv"
          style={{
            width: SV_SIZE,
            height: SV_SIZE,
            left: WHEEL_SIZE / 2 - SV_SIZE / 2,
            top: WHEEL_SIZE / 2 - SV_SIZE / 2,
            backgroundColor: pureHueHex,
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            draggingRef.current = "sv";
            handleSvPointer(event.clientX, event.clientY);
          }}
        >
          <div
            className="color-wheel__handle"
            style={{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
      <div className="color-wheel__footer">
        <span className="color-wheel__swatch" style={{ background: hexInput }} aria-hidden="true" />
        <input
          className="color-wheel__hex"
          value={hexInput}
          onChange={(event) => {
            setHexInput(event.target.value);
            const rgb = hexToRgb(event.target.value);
            if (rgb) commit(rgbToHsv(...rgb));
          }}
          spellCheck={false}
          aria-label="Hex color"
        />
      </div>
    </div>
  );
}

// A compact swatch trigger + modal, for spots (like the Layers page's Custom Pins row) where a
// full inline wheel would overwhelm an already-dense row -- same "trigger opens the real controls"
// shape as PinStyleField/PinStyleTrigger in PinStyleEditor.tsx, just for a bare color with no
// shape/size.
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="color-field-trigger" style={{ background: value }} aria-label={label} onClick={() => setOpen(true)} />
      {open &&
        createPortal(
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={label}>
            <div className="product-modal pin-style-modal">
              <div className="modal-head">
                <div>
                  <div className="cb-panel__title">Pin Color</div>
                  <h2>{label}</h2>
                </div>
                <button className="icon-button" onClick={() => setOpen(false)} aria-label="Done">X</button>
              </div>
              <div className="modal-scroll pin-style-modal__body">
                <ColorWheel value={value} onChange={onChange} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
