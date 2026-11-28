const CACHE = 'novelfolio-v4';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'db.js', 'sync.js', 'export.js', 'icons.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'fonts/eb-garamond-latin-400-normal.woff2', 'fonts/eb-garamond-latin-500-normal.woff2', 'fonts/eb-garamond-latin-600-normal.woff2', 'fonts/eb-garamond-latin-400-italic.woff2', 'fonts/eb-garamond-latin-500-italic.woff2',
  'fonts/literata-latin-400-normal.woff2', 'fonts/literata-latin-600-normal.woff2', 'fonts/literata-latin-400-italic.woff2', 'fonts/literata-latin-600-italic.woff2'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/novelfolio/')) return;
  // network first so updates land quickly, cache when offline
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
