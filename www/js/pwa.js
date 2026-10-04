(function () {
  if (window.Capacitor) {
    return; // the packaged Android app ships its files locally and keeps its own storage
  }

  // Lets the app open with no connection once it's been visited.
  if ('serviceWorker' in navigator) {
    // When a new version takes over while a page is open, reload once so the new version shows
    // straight away rather than on the next visit. (Not on the very first visit, when there was
    // no older version.)
    var hadOlderVersion = !!navigator.serviceWorker.controller;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadOlderVersion && !reloading) {
        reloading = true;
        window.location.reload();
      }
    });
    window.addEventListener('load', function () {
      // updateViaCache 'none': check sw.js and js/version.js with the server itself, not a copy
      // the browser kept (GitHub Pages lets it keep one for 10 minutes).
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (registration) {
        registration.update().catch(function () {}); // check for a new version on every visit
      }).catch(function () {});
    });
  }

  // Shows the version on pages that have a place for it (the home page), for checking a
  // phone is up to date.
  window.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('appVersion');
    if (el && window.APP_VERSION) {
      el.textContent = 'Phiên bản ' + window.APP_VERSION;
    }
  });

  // All data lives in this browser's IndexedDB. Ask the browser not to clear it when the
  // phone runs low on space (Safari otherwise drops site data after weeks without a visit).
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }
})();
