const CACHE = "code-black-runtime-v3";
const TILE_HOSTS = ["api.mapbox.com", "tile.openstreetmap.org", "mesonet.agron.iastate.edu"];
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
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isTile = TILE_HOSTS.includes(url.hostname);
  const isSameOriginAsset = url.origin === self.location.origin && event.request.method === "GET";
  if (!isTile && !isSameOriginAsset) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (event.request.mode === "navigate") {
        try {
          const response = await fetch(event.request);
          if (response.ok) cache.put("/", response.clone());
          return response;
        } catch {
          return (await cache.match("/")) || Response.error();
        }
      }

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
