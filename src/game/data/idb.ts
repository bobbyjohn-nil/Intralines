// Tiny IndexedDB wrapper for caching downloaded city packs (they can be
// 10-40 MB — far beyond localStorage). Migrates the old "transit-lines"
// database into the renamed one on first touch.

const DB_NAME = 'intralines';
const OLD_DB_NAME = 'transit-lines';
const STORE = 'cityPacks';
export const PACK_FORMAT_VERSION = 3; // v3: street names on edges

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** copy everything from the old database, then delete it (runs once) */
async function migrateOldDb(): Promise<void> {
  try {
    // avoid creating an empty old DB just to check it, where the API allows
    if (typeof indexedDB.databases === 'function') {
      const names = (await indexedDB.databases()).map((d) => d.name);
      if (!names.includes(OLD_DB_NAME)) return;
    }
    const oldDb = await open(OLD_DB_NAME);
    const entries: { key: IDBValidKey; value: unknown }[] = [];
    await new Promise<void>((resolve) => {
      const tx = oldDb.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          entries.push({ key: cur.key, value: cur.value });
          cur.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
    oldDb.close();
    if (entries.length) {
      const db = await open(DB_NAME);
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const e of entries) {
          const get = store.get(e.key);
          get.onsuccess = () => {
            if (get.result === undefined) store.put(e.value, e.key);
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      db.close();
    }
    indexedDB.deleteDatabase(OLD_DB_NAME);
  } catch {
    // migration is best-effort; worst case the city re-downloads
  }
}

let ready: Promise<void> | null = null;
function ensureMigrated(): Promise<void> {
  ready ??= migrateOldDb();
  return ready;
}

export async function idbGetPack<T>(id: string): Promise<T | null> {
  try {
    await ensureMigrated();
    const db = await open(DB_NAME);
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
    await ensureMigrated();
    const db = await open(DB_NAME);
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
    await ensureMigrated();
    const db = await open(DB_NAME);
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
