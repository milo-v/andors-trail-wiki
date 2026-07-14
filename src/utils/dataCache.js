const DB_NAME = 'andors-trail-wiki-cache';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

export const CACHE_SCHEMA_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window) || !window.indexedDB) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedData(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('dataCache: read failed', err);
    return null;
  }
}

export async function setCachedData(key, value) {
  // Clone synchronously, before any await, so callers are free to mutate
  // `value` immediately after calling this function. Cloning happens inside
  // the try block so a non-cloneable `value` (e.g. containing a function)
  // is caught and logged like every other failure in this module, rather
  // than surfacing as an unhandled promise rejection.
  try {
    const snapshot = structuredClone(value);
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(snapshot, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('dataCache: write failed', err);
  }
}
