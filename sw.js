// Bump CACHE whenever any file in ASSETS changes, so installed copies update.
const CACHE = 'planner-v61';
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
  'js/dday.js',
  'js/ui.js',
  'js/postpone.js',
  'js/config.js',
  'js/cloud.js',
  'js/account.js',
  'js/settings.js',
  'js/reminders.js',
  'js/social.js',
  'js/people.js',
  'js/chat.js',
  'js/chatview.js',
  'js/film.js',
  'js/filmui.js',
  'js/write.js',
  'fonts/fraunces-latin-wght-normal.woff2',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache (GitHub Pages sends max-age=600),
  // so a new version never installs stale copies of the files.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))));
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
  // Only cache the app's own files — never Supabase/API responses.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    // 'no-cache' revalidates with the server instead of trusting the 10-minute HTTP cache.
    fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' })
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
