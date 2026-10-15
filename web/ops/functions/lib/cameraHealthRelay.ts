const ALLOWED_CAMERA_HOSTS = [/(^|\.)idrivearkansas\.com$/i, /(^|\.)iowadot\.gov$/i, /(^|\.)modot\.org$/i, /(^|\.)kandrive\.gov$/i, /(^|\.)carsprogram\.org$/i, /(^|\.)tn\.gov$/i, /(^|\.)smartway\.tn\.gov$/i];
const MAX_IMAGE_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;
export const CAMERA_HEALTH_PATH = "/api/camera-health";

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }); }

function allowedCameraUrl(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
    ALLOWED_CAMERA_HOSTS.some((pattern) => pattern.test(url.hostname));
}

async function fetchAllowedCamera(initial: URL): Promise<Response> {
  let current = initial;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowedCameraUrl(current)) throw new Error("Camera host not allowed");
    const response = await fetch(current.toString(), {
      headers: { Accept: "image/*", "User-Agent": "CodeBlackOPS-CameraHealth/1.0" },
      redirect: "manual", signal: AbortSignal.timeout(8_000),
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("Location");
    await response.body?.cancel();
    if (!location || hop === MAX_REDIRECTS) throw new Error("Camera redirect unavailable");
    current = new URL(location, current);
  }
  throw new Error("Camera redirect limit");
}

async function readBoundedImage(response: Response): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const image = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { image.set(chunk, offset); offset += chunk.byteLength; }
  return image;
}

export async function handleCameraHealth(request: Request) {
  if (request.method !== "GET") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const raw = new URL(request.url).searchParams.get("url");
  let target: URL;
  try { target = new URL(raw ?? ""); } catch { return json({ ok: false, error: "INVALID_URL" }, 400); }
  if (!allowedCameraUrl(target)) return json({ ok: false, error: "HOST_NOT_ALLOWED" }, 400);
  try {
    const response = await fetchAllowedCamera(target);
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!response.ok || !contentType.toLowerCase().startsWith("image/")) return json({ ok: false, status: response.status, error: "MEDIA_UNAVAILABLE", checkedAt: Date.now() }, 502);
    if (Number(response.headers.get("Content-Length") ?? 0) > MAX_IMAGE_BYTES) return json({ ok: false, error: "MEDIA_TOO_LARGE", checkedAt: Date.now() }, 413);
    const bytes = await readBoundedImage(response);
    if (!bytes) return json({ ok: false, error: "MEDIA_TOO_LARGE", checkedAt: Date.now() }, 413);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const fingerprint = [...new Uint8Array(digest)].slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("");
    return json({ ok: true, status: response.status, fingerprint, bytes: bytes.byteLength, etag: response.headers.get("ETag"), lastModified: response.headers.get("Last-Modified"), checkedAt: Date.now() });
  } catch { return json({ ok: false, error: "UPSTREAM_FAILED", checkedAt: Date.now() }, 502); }
}
