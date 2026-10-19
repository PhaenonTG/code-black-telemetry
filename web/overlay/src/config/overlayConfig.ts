export type OverlayPosition = "bottom" | "top";
export type PreviewBackground = "transparent" | "storm" | "road";

export interface OverlayConfig {
  scale: number;
  opacity: number;
  position: OverlayPosition;
  background: PreviewBackground;
  devPanel: boolean;
}

const DEFAULTS: OverlayConfig = {
  scale: 1,
  opacity: 1,
  position: "bottom",
  background: "storm",
  devPanel: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Reads OBS-facing configuration from the URL so an operator can control
 * placement/scale/opacity/background per browser-source instance without
 * a rebuild, e.g.
 * `?scale=0.85&opacity=0.95&position=top&bg=transparent&dev=0`.
 */
export function readOverlayConfig(search: string = window.location.search): OverlayConfig {
  const params = new URLSearchParams(search);
  const scaleParam = Number(params.get("scale"));
  const opacityParam = Number(params.get("opacity"));
  const positionParam = params.get("position");
  const bgParam = params.get("bg");
  const devParam = params.get("dev");

  return {
    scale: Number.isFinite(scaleParam) && scaleParam > 0 ? clamp(scaleParam, 0.5, 1.5) : DEFAULTS.scale,
    opacity: Number.isFinite(opacityParam) && opacityParam > 0 ? clamp(opacityParam, 0.2, 1) : DEFAULTS.opacity,
    position: positionParam === "top" ? "top" : DEFAULTS.position,
    background:
      bgParam === "transparent" || bgParam === "road" || bgParam === "storm" ? bgParam : DEFAULTS.background,
    devPanel: devParam === null ? DEFAULTS.devPanel : devParam !== "0",
  };
}
