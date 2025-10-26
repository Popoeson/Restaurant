// service-worker.js
const CACHE_NAME = "tastybite-cache-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/admin-dashboard.html",
  "/manifest.json",
  "/uploads/restaurant.jpg",
  "/uploads/food.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("📦 Caching core assets");
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Only serve cached static assets. Always pass through API requests.
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Always let API calls go to network (no cache)
  if (url.pathname.startsWith("/api/") || url.origin !== location.origin) {
    return event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
  }

  // For other requests, return cached asset or fetch-and-cache
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache only GET and same-origin static responses
        if (event.request.method === "GET" && response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match("/index.html"));
    })
  );
});
