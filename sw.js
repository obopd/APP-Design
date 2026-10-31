// Bump CACHE whenever any file in ASSETS changes, so installed copies update.
const CACHE = 'planner-v6';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/util.js',
  'js/store.js',
  'js/calendar.js',
  'js/day.js',
  'js/editor.js',
  'js/folders.js',
  'js/settings.js',
  'js/reminders.js',
  'fonts/fraunces-latin-wght-normal.woff2',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

// Network first so updates appear when online; cache when offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});

// Tapping a notification opens (or focuses) the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) =>
      clients.length ? clients[0].focus() : self.clients.openWindow('./')),
  );
});
