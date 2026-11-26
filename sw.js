// Keeps the whole app on the phone so it opens and works with no signal.
// Bump VERSION whenever any file changes; the app then shows "Update available".
const VERSION = "v3";
const CACHE = `aba-data-${VERSION}`;
const SHELL = [
  "./", "index.html", "styles.css", "manifest.webmanifest",
  "js/app.js", "js/db.js", "js/model.js", "js/summary.js", "js/ui.js", "js/session.js", "js/export.js", "js/graphs.js",
  "vendor/exceljs.min.js",
  "icons/icon-192.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((p) => new Request(p, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("aba-data-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache first: instant and offline. New versions arrive through a new service worker (VERSION bump).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = event.request.mode === "navigate" ? "index.html" : event.request;
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    const resp = await fetch(event.request);
    if (resp.ok) cache.put(key, resp.clone());
    return resp;
  })());
});
