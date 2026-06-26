// Service worker for TabSpace PWA
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // A pass-through fetch handler is required to satisfy Chrome/Chromium
  // installability requirements. We do not do active caching of JS/CSS files
  // here to prevent "ChunkLoadError" or cached stale builds after redeployment.
  event.respondWith(fetch(event.request));
});
