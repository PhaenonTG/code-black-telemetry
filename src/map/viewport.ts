import type { Map as MapboxMap } from "mapbox-gl";

export interface MapViewport {
  north: number;
  south: number;
  east: number;
  west: number;
  zoom: number;
}

export type ZoomDetailLevel = "far" | "medium" | "close";

export function viewportFromMap(map: MapboxMap): MapViewport {
  const bounds = map.getBounds();
  const center = map.getCenter();
  if (!bounds) {
    return { north: center.lat, south: center.lat, east: center.lng, west: center.lng, zoom: map.getZoom() };
  }
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
    zoom: map.getZoom(),
  };
}

export function pointInViewport(point: { lat: number; lon: number }, viewport: MapViewport) {
  return point.lat <= viewport.north && point.lat >= viewport.south && point.lon >= viewport.west && point.lon <= viewport.east;
}

export function zoomDetailLevel(zoom: number): ZoomDetailLevel {
  if (zoom >= 9) return "close";
  if (zoom >= 5.5) return "medium";
  return "far";
}

export function filterViewportPoints<T extends { lat: number; lon: number }>(points: T[], viewport: MapViewport, paddingDegrees = 0.35) {
  const padded = {
    north: viewport.north + paddingDegrees,
    south: viewport.south - paddingDegrees,
    east: viewport.east + paddingDegrees,
    west: viewport.west - paddingDegrees,
    zoom: viewport.zoom,
  };
  return points.filter((point) => pointInViewport(point, padded));
}

export interface ClusterablePoint {
  id: string;
  lat: number;
  lon: number;
}

export interface MapCluster<T extends ClusterablePoint> {
  id: string;
  lat: number;
  lon: number;
  count: number;
  points: T[];
}

export function clusterViewportPoints<T extends ClusterablePoint>(points: T[], viewport: MapViewport): Array<T | MapCluster<T>> {
  const detail = zoomDetailLevel(viewport.zoom);
  if (detail === "close") return points;
  const cellSize = detail === "medium" ? 0.18 : 0.85;
  const cells = new Map<string, T[]>();
  for (const point of points) {
    const key = `${Math.floor(point.lat / cellSize)}:${Math.floor(point.lon / cellSize)}`;
    const cell = cells.get(key);
    if (cell) {
      cell.push(point);
    } else {
      cells.set(key, [point]);
    }
  }
  const result: Array<T | MapCluster<T>> = [];
  for (const [key, cell] of cells.entries()) {
    if (cell.length === 1) {
      result.push(cell[0]);
      continue;
    }
    const lat = cell.reduce((sum, point) => sum + point.lat, 0) / cell.length;
    const lon = cell.reduce((sum, point) => sum + point.lon, 0) / cell.length;
    result.push({ id: `cluster-${key}`, lat, lon, count: cell.length, points: cell });
  }
  return result;
}
