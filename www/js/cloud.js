(function (global) {
  // Web version only: data is kept in Firebase (Cloud Firestore) so every phone sees the same
  // data, behind one shared group login. The packaged Android app keeps using the phone's own
  // storage (db.js), so nothing here runs inside it.
  if (global.Capacitor || !global.firebase || !global.FIREBASE_CONFIG) {
    return;
  }

  firebase.initializeApp(global.FIREBASE_CONFIG);
  var auth = firebase.auth();
  var db = firebase.firestore();
  db.settings({ ignoreUndefinedProperties: true, merge: true });
  // Keeps a copy on the phone so the app opens and saves offline; changes sync when back online.
  var persistence = db.enablePersistence({ synchronizeTabs: true }).catch(function () {});

  // Small collections are kept in sync with live listeners and read from the phone's copy, so
  // moving between screens costs (almost) no Firestore reads. Games grow every day, so they're
  // only ever fetched for the day being looked at.
  var SYNCED = ['players', 'gameDays', 'months', 'members'];
  var SERVER_WAIT_MS = 4000;
  var WRITE_WAIT_MS = 2000;

  // ---- Group login ----
  // A phone logs in once and stays logged in. Firebase only ends that login when the group
  // password is changed, so if a phone that was logged in sees the login screen again, say why.

  var SIGNED_IN_KEY = 'madamDung.signedIn';
  var loginEl = null;

  function load(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function store(key, value) {
    try {
      if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    } catch (e) {}
  }

  function wasSignedInBefore() {
    return load(SIGNED_IN_KEY) === '1';
  }

  // ---- Player phones ----
  // A phone whose first login happens on a shared Player Game List link is a "player" phone: it
  // can only use the Player Game List of that day and Thêm Set, and every other page sends it
  // back there. Opening a link for another day moves it to that day.

  var PLAYER_DAY_KEY = 'madamDung.playerDayId';

  // A random id for this phone, kept for good. Games remember which phone added them, so a
  // player can only change or delete their own sets on the Player Game List.
  var DEVICE_ID_KEY = 'madamDung.deviceId';
  global.DEVICE_ID = load(DEVICE_ID_KEY);
  if (!global.DEVICE_ID) {
    global.DEVICE_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    store(DEVICE_ID_KEY, global.DEVICE_ID);
  }
  var PLAYER_PAGES = ['player-day.html', 'game-form.html'];
  var pageName = window.location.pathname.split('/').pop() || 'index.html';
  var pageDayId = new URLSearchParams(window.location.search).get('id');

  var lockedDayId = load(PLAYER_DAY_KEY);
  if (lockedDayId && pageName === 'player-day.html' && pageDayId) {
    lockedDayId = pageDayId;
    store(PLAYER_DAY_KEY, lockedDayId);
  }
  if (lockedDayId && PLAYER_PAGES.indexOf(pageName) === -1) {
    window.location.replace('player-day.html?id=' + lockedDayId);
  }

  function showLogin() {
    if (loginEl) {
      loginEl.hidden = false;
      return;
    }
    loginEl = document.createElement('div');
    loginEl.className = 'login-overlay';
    loginEl.innerHTML =
      '<form class="login-card" novalidate>' +
      '<h2>Madam Dung Badminton</h2>' +
      (wasSignedInBefore() ? '<p class="login-note">Mật khẩu nhóm đã thay đổi. Vui lòng nhập mật khẩu mới.</p>' : '') +
      '<div class="form-group">' +
      '<label for="groupPassword">Mật khẩu nhóm</label>' +
      // The group password is digits only, so phones show just the number pad.
      '<input type="password" id="groupPassword" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" enterkeyhint="go">' +
      '</div>' +
      '<p class="field-error" hidden></p>' +
      '<button type="submit" class="primary-button">Đăng nhập</button>' +
      '</form>';
    var form = loginEl.querySelector('form');
    var input = loginEl.querySelector('input');
    // Drop anything that isn't a digit (e.g. pasted or autofilled text).
    input.addEventListener('input', function () {
      var digits = input.value.replace(/\D/g, '');
      if (digits !== input.value) {
        input.value = digits;
      }
    });
    var errorEl = loginEl.querySelector('.field-error');
    var button = loginEl.querySelector('button');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.hidden = true;
      button.disabled = true;
      // Phone keyboards can add a space before or after; the group password has none.
      auth.signInWithEmailAndPassword(global.FIREBASE_GROUP_EMAIL, input.value.trim()).catch(function (err) {
        button.disabled = false;
        errorEl.textContent = loginErrorMessage(err);
        errorEl.hidden = false;
      });
    });
    document.body.appendChild(loginEl);
    input.focus();
  }

  // Only a refused password is "Sai mật khẩu"; anything else says what actually went wrong.
  function loginErrorMessage(err) {
    var code = (err && err.code) || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
      return 'Sai mật khẩu';
    }
    if (code === 'auth/too-many-requests') {
      return 'Nhập sai quá nhiều lần nên tạm bị khóa. Vui lòng đợi vài phút rồi thử lại.';
    }
    if (code === 'auth/network-request-failed') {
      return 'Không có kết nối mạng. Vui lòng thử lại.';
    }
    if (code === 'auth/web-storage-unsupported') {
      return 'Trình duyệt này không cho đăng nhập. Hãy mở link bằng Chrome hoặc Safari.';
    }
    return 'Không đăng nhập được (' + (code || (err && err.message) || 'lỗi không xác định') + '). Hãy thử mở link bằng Chrome hoặc Safari.';
  }

  function whenBodyReady(fn) {
    if (document.body) {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  }

  var signedIn = new Promise(function (resolve) {
    var wasSignedIn = false;
    auth.onAuthStateChanged(function (user) {
      if (user) {
        if (!wasSignedInBefore() && pageName === 'player-day.html' && pageDayId) {
          store(PLAYER_DAY_KEY, pageDayId); // first login came through a Player Game List link
        }
        wasSignedIn = true;
        store(SIGNED_IN_KEY, '1');
        if (loginEl) {
          loginEl.hidden = true;
        }
        resolve(user);
      } else if (wasSignedIn) {
        window.location.reload(); // signed out: start again from the login screen
      } else {
        whenBodyReady(showLogin);
      }
    });
  });

  // ---- Live sync of the small collections ----

  var synced = signedIn.then(function () {
    return persistence;
  }).then(function () {
    return Promise.all(SYNCED.map(function (store) {
      return new Promise(function (resolve) {
        var done = false;
        function finish() {
          if (!done) {
            done = true;
            resolve();
          }
        }
        // Use the phone's copy straight away when offline; otherwise wait (briefly) for the
        // server so the screen shows changes made on other phones.
        setTimeout(finish, SERVER_WAIT_MS);
        db.collection(store).onSnapshot({ includeMetadataChanges: true }, function (snap) {
          if (!snap.metadata.fromCache || !navigator.onLine) {
            finish();
          }
        }, finish);
      });
    }));
  });

  function ready(store) {
    return SYNCED.indexOf(store) !== -1 ? synced : signedIn.then(function () {
      return persistence;
    });
  }

  function readOptions(store) {
    return SYNCED.indexOf(store) !== -1 ? { source: 'cache' } : undefined;
  }

  // ---- The same interface as db.js ----

  // Numeric like the phone-storage ids (pages pass them in URLs) and increasing over time, so
  // "newest first" sorting by id still works; the random part keeps two phones from clashing.
  function newId() {
    return Date.now() * 1000 + Math.floor(Math.random() * 1000);
  }

  function data(snap) {
    return snap.docs.map(function (d) {
      return d.data();
    });
  }

  function reportWriteError(err) {
    console.error('Firestore write failed', err);
    if (err && err.code === 'permission-denied') {
      alert('Không lưu được: bạn không có quyền. Vui lòng đăng nhập lại.');
    }
  }

  // A write shows up in the phone's copy at once but only resolves when the server has it.
  // Don't hold the app up for that: offline, the write is sent when the phone reconnects.
  function settle(writePromise) {
    writePromise.catch(reportWriteError);
    return Promise.race([writePromise, new Promise(function (resolve) {
      setTimeout(resolve, WRITE_WAIT_MS);
    })]);
  }

  function save(storeName, value) {
    return ready(storeName).then(function () {
      var record = Object.assign({}, value);
      if (record.id === undefined || record.id === null) {
        record.id = newId();
      }
      return settle(db.collection(storeName).doc(String(record.id)).set(record)).then(function () {
        return record.id;
      });
    });
  }

  function get(storeName, id) {
    return ready(storeName).then(function () {
      return db.collection(storeName).doc(String(id)).get(readOptions(storeName));
    }).then(function (snap) {
      return snap.exists ? snap.data() : undefined;
    }, function () {
      return undefined; // not in the phone's copy
    });
  }

  function getAll(storeName) {
    return ready(storeName).then(function () {
      return db.collection(storeName).get(readOptions(storeName));
    }).then(data);
  }

  function getAllByIndex(storeName, field, value) {
    return ready(storeName).then(function () {
      return db.collection(storeName).where(field, '==', value).get(readOptions(storeName));
    }).then(data);
  }

  // Calls onChange with the matching records now and again whenever any of them changes on any
  // phone. Returns a function that stops listening.
  function watchByIndex(storeName, field, value, onChange) {
    var stop = null;
    var stopped = false;
    ready(storeName).then(function () {
      if (!stopped) {
        stop = db.collection(storeName).where(field, '==', value).onSnapshot(function (snap) {
          onChange(data(snap));
        }, function (err) {
          console.error('Firestore listen failed', err);
        });
      }
    });
    return function () {
      stopped = true;
      if (stop) {
        stop();
      }
    };
  }

  function remove(storeName, id) {
    return ready(storeName).then(function () {
      return settle(db.collection(storeName).doc(String(id)).delete());
    });
  }

  global.CloudDb = {
    add: save,
    put: save,
    get: get,
    getAll: getAll,
    getAllByIndex: getAllByIndex,
    remove: remove,
    watchByIndex: watchByIndex
  };
})(window);
