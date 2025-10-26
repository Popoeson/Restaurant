// service-worker.js
const CACHE_NAME = "tastybite-cache-v3";
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

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // 🔹 Never cache API requests — always go to the network
  if (url.pathname.startsWith("/api/") || url.origin !== location.origin) {
    return event.respondWith(fetch(event.request).catch(() => new Response("Offline", { status: 503 })));
  }

  // 🔹 For other requests, use cache-first fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache only static GET requests
        if (event.request.method === "GET" && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
