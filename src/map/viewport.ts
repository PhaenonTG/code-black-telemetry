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

// Forward-geodesic destination point (great-circle, spherical-earth approximation). Was
// duplicated byte-for-byte in AtlasVehicleLayer.ts (heading-cone geometry) and
// AtlasRangeRingLayer.ts (range-ring geometry) under two different names -- a fix or precision
// change in one would silently not propagate to the other. Both now import this.
export function destinationPoint(lat: number, lon: number, bearingDeg: number, miles: number): [number, number] {
  const radiusMiles = 3958.7613;
  const distance = miles / radiusMiles;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance) + Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1), Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2));
  return [((((lon2 * 180) / Math.PI) + 540) % 360) - 180, (lat2 * 180) / Math.PI];
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

export interface ClusterOptions {
  individualAtZoom?: number;
  mediumAtZoom?: number;
  mediumCellDegrees?: number;
  farCellDegrees?: number;
}

export function clusterViewportPoints<T extends ClusterablePoint>(points: T[], viewport: MapViewport, options: ClusterOptions = {}): Array<T | MapCluster<T>> {
  const individualAtZoom = options.individualAtZoom ?? 9;
  const mediumAtZoom = options.mediumAtZoom ?? 5.5;
  if (viewport.zoom >= individualAtZoom) return points;
  const cellSize = viewport.zoom >= mediumAtZoom ? (options.mediumCellDegrees ?? 0.18) : (options.farCellDegrees ?? 0.85);
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
