const ALLOWED_CAMERA_HOSTS = [/(^|\.)idrivearkansas\.com$/i, /(^|\.)iowadot\.gov$/i, /(^|\.)modot\.org$/i, /(^|\.)kandrive\.gov$/i, /(^|\.)carsprogram\.org$/i, /(^|\.)tn\.gov$/i, /(^|\.)smartway\.tn\.gov$/i];
const MAX_IMAGE_BYTES = 3_000_000;
export const CAMERA_HEALTH_PATH = "/api/camera-health";

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }

export async function handleCameraHealth(request: Request) {
  if (request.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const raw = new URL(request.url).searchParams.get("url");
  let target: URL;
  try { target = new URL(raw ?? ""); } catch { return json({ ok: false, error: "INVALID_URL" }, 400); }
  if (target.protocol !== "https:" || !ALLOWED_CAMERA_HOSTS.some((pattern) => pattern.test(target.hostname))) return json({ ok: false, error: "HOST_NOT_ALLOWED" }, 400);
  try {
    const response = await fetch(target.toString(), { headers: { Accept: "image/*", "User-Agent": "CodeBlackOPS-CameraHealth/1.0" }, redirect: "follow" });
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!response.ok || !contentType.toLowerCase().startsWith("image/")) return json({ ok: false, status: response.status, error: "MEDIA_UNAVAILABLE", checkedAt: Date.now() }, 502);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) return json({ ok: false, error: "MEDIA_TOO_LARGE", checkedAt: Date.now() }, 413);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const fingerprint = [...new Uint8Array(digest)].slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("");
    return json({ ok: true, status: response.status, fingerprint, bytes: bytes.byteLength, etag: response.headers.get("ETag"), lastModified: response.headers.get("Last-Modified"), checkedAt: Date.now() });
  } catch { return json({ ok: false, error: "UPSTREAM_FAILED", checkedAt: Date.now() }, 502); }
}
