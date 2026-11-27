// Keeps the whole app on the phone so it opens and works with no signal.
// Bump VERSION whenever any file changes; the app then shows "Update available".
const VERSION = "v15";
const CACHE = `aba-data-${VERSION}`;
const SHELL = [
  "./", "index.html", "styles.css", "manifest.webmanifest",
  "js/app.js", "js/db.js", "js/model.js", "js/summary.js", "js/ui.js", "js/session.js", "js/export.js", "js/graphs.js", "js/xlsxcharts.js",
  "vendor/exceljs.min.js", "vendor/jszip.min.js",
  "icons/icon-192.png", "icons/apple-touch-icon.png",
];

// A new version waits until Amanda taps "Update available" (or closes the app), so an open screen never
// mixes old and new files. Versions before v15 took over straight away and their pages don't know how
// to ask, so when upgrading from one of those this version still takes over immediately.
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL.map((p) => new Request(p, { cache: "reload" })));
    const legacy = (await caches.keys()).some((k) => /^aba-data-v(\d+)$/.test(k) && Number(k.slice(10)) < 15);
    if (legacy) await self.skipWaiting();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
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
