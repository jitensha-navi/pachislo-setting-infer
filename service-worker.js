self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("pwa-cache-v1").then((cache) => {
      return cache.addAll([
        "./",
        "./index.html",
        "./script.js",
        "./manifest.json",
        "./machines/new_king_hanahana_v30.json",
        "./machines/my_juggler_v.json"
      ]);
    })
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
