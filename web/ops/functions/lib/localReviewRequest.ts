// One contract at both gateway boundaries. No caller-selected model, provider, URL or command.
export function normalizeLocalReviewRequest(path: string, text: string): { ok: true; body: string } | { ok: false; status: number } | null {
  if (path !== "/api/ai/v1/assessment/refresh" && path !== "/api/ai/v1/target-analysis") return null;
  if (new TextEncoder().encode(text).length > 512) return { ok: false, status: 413 };
  let input: unknown;
  try { input = text.trim() ? JSON.parse(text) : {} } catch { return { ok: false, status: 400 } }
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, status: 400 };
  const point = input as Record<string, unknown>;
  if (path.endsWith("/target-analysis")) {
    if (Object.keys(point).some((key) => key !== "latitude" && key !== "longitude") || typeof point.latitude !== "number" || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || typeof point.longitude !== "number" || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) return { ok: false, status: 400 };
    return { ok: true, body: JSON.stringify({ latitude: point.latitude, longitude: point.longitude }) };
  }
  return Object.keys(point).length === 0 ? { ok: true, body: "{}" } : { ok: false, status: 400 };
}
