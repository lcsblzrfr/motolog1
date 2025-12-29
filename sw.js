/* MotoLog Service Worker (offline-first app shell)
   - Cacheia interface e scripts locais
   - Cacheia Leaflet via CDN na primeira visita
   - Cacheia tiles do OSM em runtime (best-effort)
*/

const VERSION = 'motolog-v1.0.0';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './src/app.js',
  './src/db.js',
  './src/geo.js',
  './src/reports.js',
  './src/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => {
        if (!k.startsWith(VERSION)) return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

function isTileRequest(url){
  // Tiles do OSM e similares
  return /tile\.openstreetmap\.org\//.test(url) || /(a|b|c)\.tile\.openstreetmap\.org\//.test(url);
}

function isLeafletCdn(url){
  return /unpkg\.com\/leaflet@/i.test(url);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Só lida com GET
  if (req.method !== 'GET') return;

  // App shell: cache-first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  // Leaflet CDN: stale-while-revalidate
  if (isLeafletCdn(url.href)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Tiles: cache-first com fallback network
  if (isTileRequest(url.href)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // Default: network-first (mantém o app funcionando quando online)
  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

async function cacheFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try{
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  }catch(e){
    return cached || Response.error();
  }
}

async function networkFirst(request, cacheName){
  const cache = await caches.open(cacheName);
  try{
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  }catch(e){
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request){
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}
