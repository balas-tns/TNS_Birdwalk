/* TNS Bird Walk – offline support. Change VERSION whenever you upload new app files. */
const VERSION = 'tns-birdwalk-v2';
const SHELL = ['./', 'index.html', 'app.js', 'worker.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isModel = url.origin === location.origin && url.pathname.includes('/model/');
  const isCdn = /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host);
  if (isModel || isCdn) {
    // Big or third-party files: keep a copy after the first download so walks work offline.
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin === location.origin) {
    // App files: try the network first so updates arrive, fall back to the cached copy.
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
  }
});
