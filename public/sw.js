// Trade Pro PWA Service Worker
const CACHE_NAME = "tradepro-cache-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon.svg"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      )
    )
  );
  return self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Network first, fallback to cache for offline navigation
  if (e.request.method !== "GET" || e.request.url.startsWith("chrome-extension")) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then((res) => res || Promise.reject("offline")))
  );
});
