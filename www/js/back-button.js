(function () {
  var cap = window.Capacitor;
  if (!cap || !cap.Plugins || !cap.Plugins.App) {
    return; // not running inside the packaged app (e.g. opened in a plain browser) — nothing to do
  }

  var CapApp = cap.Plugins.App;
  var EXIT_WINDOW_MS = 2000;
  var lastBackPressTime = 0;
  var toastEl = null;
  var toastTimer = null;

  function showExitHint() {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.textContent = 'Bấm Back lần nữa để thoát';
      toastEl.style.position = 'fixed';
      toastEl.style.left = '50%';
      toastEl.style.bottom = '100px';
      toastEl.style.transform = 'translateX(-50%)';
      toastEl.style.background = 'rgba(0, 0, 0, 0.85)';
      toastEl.style.color = '#fff';
      toastEl.style.padding = '10px 18px';
      toastEl.style.borderRadius = '999px';
      toastEl.style.fontSize = '0.85rem';
      toastEl.style.fontWeight = '600';
      toastEl.style.zIndex = '999';
      toastEl.style.pointerEvents = 'none';
      document.body.appendChild(toastEl);
    }
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.style.display = 'none';
    }, EXIT_WINDOW_MS);
  }

  CapApp.addListener('backButton', function (data) {
    if (data && data.canGoBack) {
      window.history.back();
      return;
    }
    var now = Date.now();
    if (now - lastBackPressTime < EXIT_WINDOW_MS) {
      CapApp.exitApp();
      return;
    }
    lastBackPressTime = now;
    showExitHint();
  });
})();
