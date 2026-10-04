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

  var loginEl = null;

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
      '<div class="form-group">' +
      '<label for="groupPassword">Mật khẩu nhóm</label>' +
      '<input type="password" id="groupPassword" autocomplete="current-password" enterkeyhint="go">' +
      '</div>' +
      '<p class="field-error" hidden></p>' +
      '<button type="submit" class="primary-button">Đăng nhập</button>' +
      '</form>';
    var form = loginEl.querySelector('form');
    var input = loginEl.querySelector('input');
    var errorEl = loginEl.querySelector('.field-error');
    var button = loginEl.querySelector('button');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.hidden = true;
      button.disabled = true;
      auth.signInWithEmailAndPassword(global.FIREBASE_GROUP_EMAIL, input.value).catch(function (err) {
        button.disabled = false;
        errorEl.textContent = err && err.code === 'auth/network-request-failed'
          ? 'Không có kết nối mạng. Vui lòng thử lại.'
          : 'Sai mật khẩu';
        errorEl.hidden = false;
      });
    });
    document.body.appendChild(loginEl);
    input.focus();
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
        wasSignedIn = true;
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
    signOut: function () {
      return auth.signOut();
    }
  };
})(window);
