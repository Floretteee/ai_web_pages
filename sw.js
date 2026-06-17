const CACHE_VERSION = 'fimall-chat-sw-v1.0.0';

const CORE_ASSETS = [
  './',
  './index.html',
  './css/base.css?v=1781707260070',
  './css/components/sidebar.css?v=1781707260070',
  './css/components/settings.css?v=1781707260070',
  './css/components/chat.css?v=1781707260070',
  './css/components/input.css?v=1781707260070',
  './css/components/overlays.css?v=1781707260070',
  './css/responsive.css?v=1781707260070',
  './app.js',
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
