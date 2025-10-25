const CACHE_NAME = "tastybite-cache-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/admin-dashboard.html",
  "/manifest.json",
  "/uploads/restaurant.jpg",
  "/uploads/food.png"
];

// Install service worker
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate worker
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch logic
self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
