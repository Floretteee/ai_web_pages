const CACHE_VERSION = '__VERSION__';

const CORE_ASSETS = [
  './',
  './index.html',
  './css/base.css',
  './css/components/sidebar.css',
  './css/components/settings.css',
  './css/components/chat.css',
  './css/components/input.css',
  './css/components/overlays.css',
  './css/responsive.css',
  './js/utils.js',
  './js/renderer.js',
  './js/db.js',
  './js/state.js',
  './js/components.js',
  './js/ui.js',
  './js/tts.js',
  './js/api.js',
  './js/export.js',
  './js/queue.js',
  './js/app.js',
  './presets.js',
  './manifest.webmanifest',
  './favicon.ico',
  './FCLOGO.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './vendor/domd/domd-renderer.js',
  './vendor/domd/domd-renderer.css',
  './vendor/dompurify/purify.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/v1/') || url.hostname === 'api.fimall.cfd') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return caches.match(request).then((cached) => cached || caches.match(fallbackUrl));
  }
}
