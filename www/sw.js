// Bump when files change so phones pick up the new version.
var CACHE = 'madam-dung-v11';

var FILES = [
  './',
  'index.html',
  'month.html',
  'days.html',
  'day.html',
  'game-form.html',
  'player-day.html',
  'members.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/db.js',
  'js/services.js',
  'js/back-button.js',
  'js/player-suggest.js',
  'js/share-image.js',
  'js/html2canvas.min.js',
  'js/pwa.js',
  'js/firebase-config.js',
  'js/cloud.js',
  'js/vendor/firebase-app-compat.js',
  'js/vendor/firebase-auth-compat.js',
  'js/vendor/firebase-firestore-compat.js',
  'img/payment-qr.jpg',
  'img/icons/icon-180.png',
  'img/icons/icon-192.png',
  'img/icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(FILES);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Network first so updates show up straight away when online; the cache covers offline use.
// Pages are opened with ?id=... / ?month=..., so match them ignoring the query string.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') {
    return;
  }
  event.respondWith(
    fetch(event.request).then(function (response) {
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(event.request, copy);
        });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request, { ignoreSearch: true });
    })
  );
});
