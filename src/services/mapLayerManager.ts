import type { MapViewport, ZoomDetailLevel } from "../map/viewport";
import type { ObservationProvenance } from "./mapLayerModels";

export type OperationalMapLayerKey =
  | "base-map"
  | "radar-mosaic"
  | "nexrad-products"
  | "nws-warnings"
  | "navigation-route"
  | "breadcrumbs"
  | "team-units"
  | "spotter-network"
  | "chaser-net"
  | "human-reports"
  | "road-conditions"
  | "traffic-cameras"
  | "probes"
  | "goes"
  | "glm"
  | "model-environment";

export type OperationalLayerAvailability = "ready" | "loading" | "empty" | "stale" | "unavailable" | "error";

export interface OperationalMapLayerState {
  key: OperationalMapLayerKey;
  label: string;
  enabled: boolean;
  visible: boolean;
  opacity: number;
  order: number;
  availability: OperationalLayerAvailability;
  stale: boolean;
  message: string;
  provenance: ObservationProvenance | null;
  lastUpdatedAt: number | null;
}

export interface OperationalLayerRenderContext {
  viewport: MapViewport;
  detail: ZoomDetailLevel;
}

export const DEFAULT_OPERATIONAL_LAYER_ORDER: OperationalMapLayerKey[] = [
  "base-map",
  "radar-mosaic",
  "nexrad-products",
  "navigation-route",
  "nws-warnings",
  "road-conditions",
  "traffic-cameras",
  "breadcrumbs",
  "team-units",
  "spotter-network",
  "chaser-net",
  "human-reports",
  "probes",
  "goes",
  "glm",
  "model-environment",
];

export function clampLayerOpacity(opacity: number) {
  if (!Number.isFinite(opacity)) return 1;
  return Math.max(0, Math.min(1, opacity));
}

export function buildLayerState(input: Omit<OperationalMapLayerState, "opacity" | "stale"> & { opacity?: number; stale?: boolean }): OperationalMapLayerState {
  return {
    ...input,
    opacity: clampLayerOpacity(input.opacity ?? 1),
    stale: input.stale ?? input.availability === "stale",
  };
}

export function sortOperationalLayers<T extends Pick<OperationalMapLayerState, "order">>(layers: T[]) {
  return [...layers].sort((a, b) => a.order - b.order);
}

export function layerCanRender(layer: Pick<OperationalMapLayerState, "enabled" | "visible" | "availability">) {
  return layer.enabled && layer.visible && layer.availability !== "unavailable" && layer.availability !== "error";
}

export function notConfiguredLayer(key: OperationalMapLayerKey, label: string, order = DEFAULT_OPERATIONAL_LAYER_ORDER.indexOf(key)) {
  return buildLayerState({
    key,
    label,
    enabled: false,
    visible: false,
    opacity: 1,
    order: order < 0 ? 999 : order,
    availability: "unavailable",
    message: `${label} provider not configured.`,
    provenance: null,
    lastUpdatedAt: null,
  });
}
