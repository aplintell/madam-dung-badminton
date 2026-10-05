importScripts('js/version.js');
// Named after the app version (js/version.js), so a new version gets a fresh cache.
var CACHE = 'madam-dung-v' + self.APP_VERSION;

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
  'js/touch-guard.js',
  'js/winner-left.js',
  'js/version.js',
  'js/firebase-config.js',
  'js/cloud.js',
  'js/vendor/firebase-app-compat.js',
  'js/vendor/firebase-auth-compat.js',
  'js/vendor/firebase-firestore-compat.js',
  'img/payment-qr.jpg',
  'img/icons/icon-180.png',
  'img/icons/icon-192.png',
  'img/icons/icon-512.png',
  'img/icons/court.png',
  'img/icons/shuttlecock.png',
  'img/icons/water-bottle.png'
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

function sameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

// Network first so updates show up straight away when online; the cache covers offline use.
// The app's own files are revalidated on every load ("no-cache" still uses the copy when the
// server says it hasn't changed), so a new version shows up on the next open.
// Pages are opened with ?id=... / ?month=..., so match them ignoring the query string.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') {
    return;
  }
  event.respondWith(
    // A page-navigation request can't be given other options, so the app's files are fetched
    // through a fresh request for the same address.
    fetch(sameOrigin(event.request) ? new Request(event.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : event.request).then(function (response) {
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
