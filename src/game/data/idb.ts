// Tiny IndexedDB wrapper for caching downloaded city packs (they can be
// 10-40 MB — far beyond localStorage).

const DB_NAME = 'transit-lines';
const STORE = 'cityPacks';
export const PACK_FORMAT_VERSION = 2; // v2: added water/parks polygons

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetPack<T>(id: string): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const v = req.result;
        resolve(v && v.formatVersion === PACK_FORMAT_VERSION ? (v.pack as T) : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function idbPutPack(id: string, pack: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ formatVersion: PACK_FORMAT_VERSION, pack }, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // cache is best-effort
  }
}

export async function idbDeletePack(id: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}
