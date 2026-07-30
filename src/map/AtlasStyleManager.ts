import type { Map } from "mapbox-gl";

export type AtlasStyleResult = {
  modifiedLayers: number;
  firstSymbolLayerId: string | undefined;
  lastMapError: string;
};

function setPaint(map: Map, layerId: string, property: string, value: unknown) {
  if (!map.getLayer(layerId)) return false;
  map.setPaintProperty(layerId, property as never, value as never);
  return true;
}

export function tuneAtlasStyle(map: Map): AtlasStyleResult {
  let modifiedLayers = 0;
  let lastMapError = "";
  const style = map.getStyle();
  const layers = style.layers ?? [];
  const firstSymbolLayerId = layers.find((layer) => layer.type === "symbol")?.id;

  try {
    for (const layer of layers) {
      const id = layer.id.toLowerCase();
      if (layer.type === "background" && setPaint(map, layer.id, "background-color", "#171d22")) modifiedLayers += 1;
      if (layer.type === "fill" && id.includes("water") && setPaint(map, layer.id, "fill-color", "#243541")) modifiedLayers += 1;
      if (layer.type === "fill" && (id.includes("land") || id.includes("landuse")) && setPaint(map, layer.id, "fill-color", "#20262b")) modifiedLayers += 1;
      if (layer.type === "line" && id.includes("motorway") && setPaint(map, layer.id, "line-color", "#8e969f")) modifiedLayers += 1;
      if (layer.type === "line" && id.includes("trunk") && setPaint(map, layer.id, "line-color", "#7f878f")) modifiedLayers += 1;
      if (layer.type === "line" && id.includes("primary") && setPaint(map, layer.id, "line-color", "#747d86")) modifiedLayers += 1;
      if (layer.type === "line" && id.includes("secondary") && setPaint(map, layer.id, "line-color", "#5d6770")) modifiedLayers += 1;
      if (layer.type === "line" && id.includes("boundary") && setPaint(map, layer.id, "line-color", "#7b8794")) modifiedLayers += 1;
      if (layer.type === "symbol" && (id.includes("place") || id.includes("settlement") || id.includes("label"))) {
        if (setPaint(map, layer.id, "text-color", "#eef3f7")) modifiedLayers += 1;
        if (setPaint(map, layer.id, "text-halo-color", "rgba(4, 6, 8, 0.9)")) modifiedLayers += 1;
        if (setPaint(map, layer.id, "text-halo-width", 1.4)) modifiedLayers += 1;
      }
    }
  } catch (error) {
    lastMapError = error instanceof Error ? error.message : "STYLE_TUNE_FAILED";
  }

  return { modifiedLayers, firstSymbolLayerId, lastMapError };
}
