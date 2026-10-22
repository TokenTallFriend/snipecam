// Service worker: lets SnipeCam open without a connection and load fast.
// - App files: network first (always the latest version when online), saved copy when offline.
// - Face library (pinned version on jsDelivr): cache first; it never changes.
// - Face models: not handled here; the library stores them in IndexedDB itself.
// - tests/: never cached.

const CACHE = 'snipecam-v1';

// Every file the app needs to start. tests/unit/sw.test.js checks this list covers js/.
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'assets/nosleep.mp4',
  'js/camera.js',
  'js/capture.js',
  'js/clock.js',
  'js/db.js',
  'js/detector.js',
  'js/device.js',
  'js/enroll.js',
  'js/inbox.js',
  'js/log.js',
  'js/loop.js',
  'js/main.js',
  'js/matcher.js',
  'js/modes/index.js',
  'js/modes/tripod.js',
  'js/roster.js',
  'js/rules.js',
  'js/settings.js',
  'js/share.js',
  'js/tracker.js',
  'js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (!url.pathname.includes('/tests/')) e.respondWith(networkFirst(req));
  } else if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/dist/')) {
    e.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) ?? Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
