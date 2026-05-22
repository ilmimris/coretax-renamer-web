// ── Service Worker: cache assets for offline use ──
const CACHE_NAME = 'coretax-renamer-v1';

const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.mjs',
  '/manifest.json',
  // PDF.js from CDN — cached on first use
];

// Install: pre-cache shell assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for PDF.js CDN, cache-first for shell
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // PDF.js CDN → network-first, then cache
  if (url.includes('cdnjs.cloudflare.com/ajax/libs/pdf.js')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Shell assets → cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
