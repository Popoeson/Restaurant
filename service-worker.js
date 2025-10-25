const CACHE_NAME = "tastybite-cache-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/admin-dashboard.html",
  "/manifest.json",
  "/uploads/restaurant.jpg",
  "/uploads/food.png"
];

// ✅ INSTALL: cache key assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("📦 Caching core assets");
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// ✅ ACTIVATE: remove old cache versions
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log("🧹 Removing old cache:", key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ✅ FETCH: serve from cache, then network fallback, handle failures quietly
self.addEventListener("fetch", (event) => {
  // Ignore non-GET requests (like POST to your API)
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Cache fetched responses for future offline use
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch((err) => {
          console.warn("⚠️ Failed to fetch:", event.request.url, err);
          // Optional: return a fallback response for HTML requests
          if (event.request.headers.get("accept")?.includes("text/html")) {
            return caches.match("/index.html");
          }
          return new Response("Network error", { status: 408 });
        });
    })
  );
});
