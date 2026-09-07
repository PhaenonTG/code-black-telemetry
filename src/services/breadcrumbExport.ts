import type { BreadcrumbPoint } from "./breadcrumbTrail";

// GPX/KML generation is kept pure (no DOM/Blob/Capacitor plugin dependency) so it's trivially
// testable and safe to load from any context, including the standalone domain-test harness. The
// actual "hand the file to the user" step (downloadBreadcrumbExport below) is a thin, separately
// guarded wrapper around browser-only APIs -- the trail itself was captured but had no way out of
// the app until this existed (no GPX/KML export, no share-sheet handoff).

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoTime(point: BreadcrumbPoint): string {
  return new Date(point.timestamp).toISOString();
}

export interface BreadcrumbExportOptions {
  name?: string;
}

export function breadcrumbTrailToGpx(points: BreadcrumbPoint[], options: BreadcrumbExportOptions = {}): string {
  const name = escapeXml(options.name ?? `Code Black chase trail ${new Date().toISOString().slice(0, 10)}`);
  const trkpts = points
    .map((point) => {
      const ele = point.altitudeM != null ? `<ele>${point.altitudeM.toFixed(1)}</ele>` : "";
      const course = point.headingDeg != null ? `<course>${point.headingDeg.toFixed(1)}</course>` : "";
      const speed = point.speedMph != null ? `<speed>${(point.speedMph * 0.44704).toFixed(2)}</speed>` : "";
      return `      <trkpt lat="${point.lat}" lon="${point.lon}">${ele}<time>${isoTime(point)}</time>${course}${speed}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Code Black WX" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function breadcrumbTrailToKml(points: BreadcrumbPoint[], options: BreadcrumbExportOptions = {}): string {
  const name = escapeXml(options.name ?? `Code Black chase trail ${new Date().toISOString().slice(0, 10)}`);
  const coordinates = points
    .map((point) => `${point.lon},${point.lat}${point.altitudeM != null ? `,${point.altitudeM.toFixed(1)}` : ",0"}`)
    .join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name}</name>
    <Placemark>
      <name>${name}</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coordinates}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
`;
}

export type BreadcrumbExportFormat = "gpx" | "kml";

const MIME_TYPES: Record<BreadcrumbExportFormat, string> = {
  gpx: "application/gpx+xml",
  kml: "application/vnd.google-earth.kml+xml",
};

// Browser-only: relies on Blob/URL/document, which don't exist in the Node domain-test harness or
// (today) the native WebView's file-save story -- native gets this same download-link fallback
// for now (Capacitor's WebView does resolve a blob: download), full share-sheet handoff via
// @capacitor/filesystem + @capacitor/share is a follow-up, not yet a dependency of this app.
export function downloadBreadcrumbExport(points: BreadcrumbPoint[], format: BreadcrumbExportFormat, options: BreadcrumbExportOptions = {}): boolean {
  if (typeof document === "undefined" || points.length === 0) return false;
  const content = format === "gpx" ? breadcrumbTrailToGpx(points, options) : breadcrumbTrailToKml(points, options);
  const blob = new Blob([content], { type: MIME_TYPES[format] });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(options.name ?? "codeblack-chase-trail").replace(/[^a-z0-9-_]+/gi, "-")}.${format}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}
