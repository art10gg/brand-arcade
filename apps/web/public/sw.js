/* Offline-Cache: network-first mit Cache-Fallback (Messe-/Tablet-tauglich). */
const CACHE = "brand-arcade-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const fresh = await fetch(e.request);
        if (fresh.ok) cache.put(e.request, fresh.clone());
        return fresh;
      } catch {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        throw new Error("offline und nicht im Cache");
      }
    })
  );
});
