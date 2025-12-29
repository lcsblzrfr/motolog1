// Minimal IndexedDB wrapper (sem libs externas)
// Stores:
// - journeys (keyPath: id, index: startedAt)
// - gpsPoints (keyPath: id, indexes: journeyId, ts)
// - transactions (keyPath: id, indexes: ts, type)
// - settings (keyPath: key)

const DB_NAME = 'motolog';
const DB_VERSION = 1;

function reqToPromise(request){
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx){
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class DB {
  /** @type {IDBDatabase|null} */
  db = null;

  async open(){
    if (this.db) return this.db;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;

      if (!db.objectStoreNames.contains('journeys')) {
        const s = db.createObjectStore('journeys', { keyPath: 'id' });
        s.createIndex('startedAt', 'startedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('gpsPoints')) {
        const s = db.createObjectStore('gpsPoints', { keyPath: 'id' });
        s.createIndex('journeyId', 'journeyId', { unique: false });
        s.createIndex('ts', 'ts', { unique: false });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('ts', 'ts', { unique: false });
        s.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Pequeno registro de versão
      const now = Date.now();
      try{
        const tx = event.target.transaction;
        tx.objectStore('settings').put({ key: 'createdAt', value: now });
      }catch(_){/* ignore */}
    };

    this.db = await reqToPromise(request);
    return this.db;
  }

  _tx(storeNames, mode='readonly'){
    const tx = this.db.transaction(storeNames, mode);
    return tx;
  }

  async get(store, key){
    await this.open();
    const tx = this._tx([store]);
    const res = await reqToPromise(tx.objectStore(store).get(key));
    await txDone(tx);
    return res;
  }

  async put(store, value){
    await this.open();
    const tx = this._tx([store], 'readwrite');
    await reqToPromise(tx.objectStore(store).put(value));
    await txDone(tx);
    return true;
  }

  async add(store, value){
    await this.open();
    const tx = this._tx([store], 'readwrite');
    await reqToPromise(tx.objectStore(store).add(value));
    await txDone(tx);
    return true;
  }

  async del(store, key){
    await this.open();
    const tx = this._tx([store], 'readwrite');
    await reqToPromise(tx.objectStore(store).delete(key));
    await txDone(tx);
    return true;
  }

  async clear(store){
    await this.open();
    const tx = this._tx([store], 'readwrite');
    await reqToPromise(tx.objectStore(store).clear());
    await txDone(tx);
    return true;
  }

  async getAll(store){
    await this.open();
    const tx = this._tx([store]);
    const res = await reqToPromise(tx.objectStore(store).getAll());
    await txDone(tx);
    return res;
  }

  async getAllByIndex(store, indexName, query){
    await this.open();
    const tx = this._tx([store]);
    const index = tx.objectStore(store).index(indexName);
    const res = await reqToPromise(index.getAll(query));
    await txDone(tx);
    return res;
  }

  async getRangeByIndex(store, indexName, lower, upper){
    await this.open();
    const tx = this._tx([store]);
    const index = tx.objectStore(store).index(indexName);
    const range = IDBKeyRange.bound(lower, upper);
    const res = await reqToPromise(index.getAll(range));
    await txDone(tx);
    return res;
  }

  async bulkPut(store, values){
    await this.open();
    const tx = this._tx([store], 'readwrite');
    const os = tx.objectStore(store);
    for (const v of values) os.put(v);
    await txDone(tx);
    return true;
  }

  async bulkAdd(store, values){
    await this.open();
    const tx = this._tx([store], 'readwrite');
    const os = tx.objectStore(store);
    for (const v of values) os.add(v);
    await txDone(tx);
    return true;
  }

  async deleteWhereIndexEquals(store, indexName, value){
    await this.open();
    const tx = this._tx([store], 'readwrite');
    const os = tx.objectStore(store);
    const index = os.index(indexName);
    const req = index.openCursor(IDBKeyRange.only(value));
    await new Promise((resolve, reject) => {
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve(true);
        }
      };
      req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return true;
  }
}

export function uid(prefix='id'){
  // ID curto, suficiente para uso local
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
