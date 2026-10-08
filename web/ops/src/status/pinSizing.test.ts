import { describe, expect, it } from "vitest";
import { applyPinStyle, type PinPoint } from "../../../../src/map/AtlasPinMarkers";

function marker() {
  const properties = new Map<string, string>();
  const classes = new Set<string>();
  const element = {
    style: {
      setProperty(name: string, value: string) { properties.set(name, value); },
      removeProperty(name: string) { properties.delete(name); },
    },
    classList: { toggle(name: string, active: boolean) { if (active) classes.add(name); else classes.delete(name); } },
  } as unknown as HTMLDivElement;
  return { element, properties, classes };
}
const style = { color: "#facc15", shape: "circle" as const, sizeScale: .84 };
const point: PinPoint = { id: "station", lat: 36, lon: -94, family: "station" };
describe("map station sizing", () => {
  it("keeps missing-reading glyphs explicitly sized", () => {
    const m = marker(); applyPinStyle(m.element, style, 9, point);
    expect(parseFloat(m.properties.get("width")!)).toBeLessThan(23);
    expect(m.classes.has("atlas-pin-marker--label")).toBe(false);
  });
  it("clears label constraints when a reading disappears", () => {
    const m = marker(); applyPinStyle(m.element, style, 9, { ...point, markerLabel: "58°" });
    expect(m.properties.get("width")).toBe("auto");
    applyPinStyle(m.element, style, 9, point);
    expect(m.properties.get("width")).not.toBe("auto");
    expect(m.properties.has("min-width")).toBe(false);
    expect(m.properties.has("padding")).toBe(false);
    expect(m.classes.has("atlas-pin-marker--label")).toBe(false);
  });
  it("does not apply text-badge sizing to clusters", () => {
    const m = marker(); applyPinStyle(m.element, style, 9, { ...point, markerLabel: "58°", clusterCount: 12 });
    expect(m.classes.has("atlas-pin-marker--label")).toBe(false);
    expect(m.properties.get("width")).not.toBe("auto");
  });
});
