/* TNS Bird Walk – offline support and updates.
   App files: fetched fresh whenever the phone is online, so walkers get updates automatically.
   Model files: downloaded once and kept. Change MODEL_CACHE only when you upload a new model,
   because every phone then downloads the ~75 MB model again. */
const VERSION = 'tns-birdwalk-v9';
const MODEL_CACHE = 'tns-model-v1';
const SHELL = ['./', 'index.html', 'app.js', 'worker.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'names/te.csv', 'names/hi.csv', 'names/ta.csv'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== MODEL_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isModel = url.origin === location.origin && url.pathname.includes('/model/');
  const isCdn = /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host);
  if (isModel || isCdn) {
    // Big or third-party files: keep a copy after the first download so walks work offline.
    e.respondWith(caches.open(isModel ? MODEL_CACHE : VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin === location.origin) {
    // App files: network first so updates arrive, cached copy when offline.
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
  }
});
