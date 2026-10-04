(function (global) {
  var DB_NAME = 'badminton';
  var DB_VERSION = 3;
  var dbPromise = null;

  function openDb() {
    if (dbPromise) {
      return dbPromise;
    }
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('players')) {
          var players = db.createObjectStore('players', { keyPath: 'id', autoIncrement: true });
          players.createIndex('nameLower', 'nameLower', { unique: true });
        }
        if (!db.objectStoreNames.contains('gameDays')) {
          db.createObjectStore('gameDays', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('games')) {
          var games = db.createObjectStore('games', { keyPath: 'id', autoIncrement: true });
          games.createIndex('gameDayId', 'gameDayId');
        }
        if (!db.objectStoreNames.contains('months')) {
          var months = db.createObjectStore('months', { keyPath: 'id', autoIncrement: true });
          months.createIndex('key', 'key', { unique: true });
        }
        if (!db.objectStoreNames.contains('members')) {
          var members = db.createObjectStore('members', { keyPath: 'id', autoIncrement: true });
          members.createIndex('monthKey', 'monthKey');
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
    return dbPromise;
  }

  function tx(storeNames, mode) {
    return openDb().then(function (db) {
      return db.transaction(storeNames, mode);
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function add(storeName, value) {
    return tx([storeName], 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore(storeName).add(value));
    });
  }

  function put(storeName, value) {
    return tx([storeName], 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore(storeName).put(value));
    });
  }

  function get(storeName, id) {
    return tx([storeName], 'readonly').then(function (t) {
      return reqToPromise(t.objectStore(storeName).get(id));
    });
  }

  function getAll(storeName) {
    return tx([storeName], 'readonly').then(function (t) {
      return reqToPromise(t.objectStore(storeName).getAll());
    });
  }

  function getAllByIndex(storeName, indexName, query) {
    return tx([storeName], 'readonly').then(function (t) {
      return reqToPromise(t.objectStore(storeName).index(indexName).getAll(query));
    });
  }

  function remove(storeName, id) {
    return tx([storeName], 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore(storeName).delete(id));
    });
  }

  global.BadmintonDb = {
    add: add,
    put: put,
    get: get,
    getAll: getAll,
    getAllByIndex: getAllByIndex,
    remove: remove
  };
})(window);
