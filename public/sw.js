const CACHE = "code-black-runtime-v1";
const TILE_HOSTS = ["api.mapbox.com", "tile.openstreetmap.org", "tilecache.rainviewer.com"];
const APP_ASSETS = ["/", "/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isTile = TILE_HOSTS.includes(url.hostname);
  const isSameOriginAsset = url.origin === self.location.origin && event.request.method === "GET";
  if (!isTile && !isSameOriginAsset) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      try {
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      } catch {
        return cached || Response.error();
      }
    }),
  );
});
