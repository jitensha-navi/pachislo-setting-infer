// ===============================
//  PWA キャッシュ（最小構成）
//  ・index.html / script.js / manifest.json をキャッシュ
//  ・machines/machines.json だけキャッシュ
//  ・個別の機種 JSON はキャッシュしない（更新が楽）
// ===============================

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("pwa-cache-v2").then((cache) => {
      return cache.addAll([
        "./",
        "./index.html",
        "./script.js",
        "./manifest.json",
        "./machines/machines.json"
      ]);
    })
  );
});

// ===============================
//  fetch イベント
//  ・キャッシュにあれば返す
//  ・なければネットワークから取得
// ===============================
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
