(function () {
  if (window.Capacitor) {
    return; // the packaged Android app ships its files locally and keeps its own storage
  }

  // Lets the app open with no connection once it's been visited.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  // All data lives in this browser's IndexedDB. Ask the browser not to clear it when the
  // phone runs low on space (Safari otherwise drops site data after weeks without a visit).
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }
})();
