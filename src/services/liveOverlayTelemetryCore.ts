import {
  LIVE_OVERLAY_TELEMETRY_INGEST_PATH,
  LIVE_OVERLAY_TELEMETRY_READ_PATH_PREFIX,
  type LiveOverlayTelemetryFreshnessPolicy,
  type LiveOverlayTelemetryLatestStore,
} from "./liveOverlayTelemetryModel";

export interface LiveOverlayTelemetryCoreHandlerOptions {
  store: LiveOverlayTelemetryLatestStore;
  freshnessPolicy?: LiveOverlayTelemetryFreshnessPolicy;
  now?: () => number;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function handleLiveOverlayTelemetryCoreRequest(request: Request, options: LiveOverlayTelemetryCoreHandlerOptions) {
  const now = options.now?.() ?? Date.now();
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === LIVE_OVERLAY_TELEMETRY_INGEST_PATH) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, errorCode: "MALFORMED_PAYLOAD", errorSummary: "Request body must be JSON." }, 400);
    }
    const result = options.store.ingest(request.headers.get("authorization"), body, now, options.freshnessPolicy);
    if (!result.accepted) {
      const status = result.errorCode === "AUTH_REQUIRED" ? 401
        : result.errorCode === "AUTH_FAILED" || result.errorCode === "UNKNOWN_STATION" ? 403
          : 400;
      return jsonResponse({ ok: false, errorCode: result.errorCode, errorSummary: result.errorSummary }, status);
    }
    return jsonResponse({ ok: true, snapshot: result.snapshot });
  }

  if (request.method === "GET" && url.pathname.startsWith(`${LIVE_OVERLAY_TELEMETRY_READ_PATH_PREFIX}/`)) {
    const stationId = decodeURIComponent(url.pathname.slice(LIVE_OVERLAY_TELEMETRY_READ_PATH_PREFIX.length + 1));
    const result = options.store.read(stationId, now, options.freshnessPolicy);
    if (!result.found) return jsonResponse({ ok: false, errorCode: "NOT_FOUND", errorSummary: "No live telemetry for that station." }, 404);
    return jsonResponse({ ok: true, snapshot: result.snapshot });
  }

  return jsonResponse({ ok: false, errorCode: "NOT_FOUND", errorSummary: "Live overlay telemetry route not found." }, 404);
}
