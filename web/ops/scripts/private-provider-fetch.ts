const maxProviderBytes = 5_000_000;
const maxEntries = 64;
const allowedPaths: Record<string, string> = {
  "www.kandrive.gov": "/api/graphql",
  "mapping.modot.org": "/arcgis/rest/services/TravelerInformation/",
  "oktraffic.org": "/api/Geojsons/",
  "data.transportation.gov": "/resource/69qe-yiui.json",
  "www.tdot.tn.gov": "/opendata/api/public/",
};

type Cached = { expiresAt: number; status: number; bytes: Uint8Array; contentType: string };
const cache = new Map<string, Cached>();

function allowed(url: URL): boolean {
  const prefix = allowedPaths[url.hostname];
  return url.protocol === "https:" && Boolean(prefix) &&
    (url.pathname === prefix || (prefix.endsWith("/") && url.pathname.startsWith(prefix))) &&
    !url.username && !url.password && !url.hash && (url.port === "" || url.port === "443");
}

async function limitedBytes(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get("Content-Length") ?? 0) > maxProviderBytes) throw new Error("Provider response too large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxProviderBytes) {
      await reader.cancel();
      throw new Error("Provider response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function restored(entry: Cached): Response {
  return new Response([204, 205, 304].includes(entry.status) ? null : entry.bytes.slice(), {
    status: entry.status, headers: { "Content-Type": entry.contentType },
  });
}

export async function privateProviderFetch(input: RequestInfo | URL, init: RequestInit = {}, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!allowed(url)) throw new Error("Provider URL not allowed");
  const method = init.method || "GET";
  if (method !== "GET" && !(url.hostname === "www.kandrive.gov" && method === "POST"))
    throw new Error("Provider method not allowed");
  const body = typeof init.body === "string" ? init.body : undefined;
  if (method === "POST" && (!body || Buffer.byteLength(body) > 24_000)) throw new Error("Provider request too large");
  const key = `${method} ${url.href} ${body ?? ""}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return restored(cached);
  if (cached) cache.delete(key);
  const upstream = await upstreamFetch(url, {
    method,
    headers: init.headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (upstream.status >= 300 && upstream.status < 400) throw new Error("Provider redirect rejected");
  const bytes = await limitedBytes(upstream);
  const entry: Cached = {
    expiresAt: Date.now() + (url.hostname === "data.transportation.gov" ? 3600 : method === "POST" ? 30 : 60) * 1000,
    status: upstream.status,
    bytes,
    contentType: upstream.headers.get("Content-Type") || "application/json",
  };
  if (upstream.ok) {
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
    cache.set(key, entry);
  }
  return restored(entry);
}
