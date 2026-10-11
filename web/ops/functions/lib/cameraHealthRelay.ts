const ALLOWED_CAMERA_HOSTS = [/(^|\.)idrivearkansas\.com$/i, /(^|\.)iowadot\.gov$/i, /(^|\.)modot\.org$/i, /(^|\.)kandrive\.gov$/i, /(^|\.)carsprogram\.org$/i, /(^|\.)tn\.gov$/i, /(^|\.)smartway\.tn\.gov$/i, /^streamer\.nationcam\.com$/i];
const MAX_IMAGE_BYTES = 3_000_000;
export const CAMERA_HEALTH_PATH = "/api/camera-health";

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }

export async function handleCameraHealth(request: Request) {
  if (request.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const raw = new URL(request.url).searchParams.get("url");
  let target: URL;
  try { target = new URL(raw ?? ""); } catch { return json({ ok: false, error: "INVALID_URL" }, 400); }
  if (target.protocol !== "https:" || !ALLOWED_CAMERA_HOSTS.some((pattern) => pattern.test(target.hostname))) return json({ ok: false, error: "HOST_NOT_ALLOWED" }, 400);
  if (target.hostname === "streamer.nationcam.com" && !/^\/memfs\/[a-f0-9-]+\.jpg$/i.test(target.pathname)) return json({ ok: false, error: "PATH_NOT_ALLOWED" }, 400);
  try {
    const response = await fetch(target.toString(), { headers: { Accept: "image/*", "User-Agent": "CodeBlackOPS-CameraHealth/1.0" }, redirect: "error", signal: AbortSignal.timeout(8_000) });
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!response.ok || !contentType.toLowerCase().startsWith("image/")) return json({ ok: false, status: response.status, error: "MEDIA_UNAVAILABLE", checkedAt: Date.now() }, 502);
    const advertisedBytes = Number(response.headers.get("Content-Length"));
    if (advertisedBytes > MAX_IMAGE_BYTES) { await response.body?.cancel(); return json({ ok: false, error: "MEDIA_TOO_LARGE", checkedAt: Date.now() }, 413); }
    const reader = response.body?.getReader();
    if (!reader) return json({ ok: false, error: "MEDIA_UNAVAILABLE", checkedAt: Date.now() }, 502);
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) { await reader.cancel(); return json({ ok: false, error: "MEDIA_TOO_LARGE", checkedAt: Date.now() }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const fingerprint = [...new Uint8Array(digest)].slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("");
    return json({ ok: true, status: response.status, fingerprint, bytes: totalBytes, etag: response.headers.get("ETag"), lastModified: response.headers.get("Last-Modified"), checkedAt: Date.now() });
  } catch { return json({ ok: false, error: "UPSTREAM_FAILED", checkedAt: Date.now() }, 502); }
}
