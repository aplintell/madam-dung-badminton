(function (global) {
  // Tells whether a finger is on the screen, so a list isn't redrawn under a swipe or double tap.
  // A touch doesn't always end with pointerup/pointercancel (it can turn into a page scroll or a
  // system gesture, or a popup / share sheet opens mid-tap), so a touch only counts while it is
  // still pressing or moving recently; a stale one can never block updates for good.
  var STALE_MS = 3000;
  var pointerDown = false;
  var lastActivity = 0;

  document.addEventListener('pointerdown', function () {
    pointerDown = true;
    lastActivity = Date.now();
  }, true);
  document.addEventListener('pointermove', function () {
    if (pointerDown) {
      lastActivity = Date.now();
    }
  }, true);
  ['pointerup', 'pointercancel'].forEach(function (type) {
    document.addEventListener(type, function () {
      pointerDown = false;
    }, true);
  });
  // Leaving the page (phone locked, app switched) ends any touch.
  document.addEventListener('visibilitychange', function () {
    pointerDown = false;
  });

  global.TouchGuard = {
    isTouching: function () {
      return pointerDown && Date.now() - lastActivity < STALE_MS;
    }
  };
})(window);
