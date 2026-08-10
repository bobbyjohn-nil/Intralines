// Tiny IndexedDB wrapper for caching downloaded city packs (they can be
// 10-40 MB — far beyond localStorage). Migrates the old "transit-lines"
// database into the renamed one on first touch.

const DB_NAME = 'intralines';
const OLD_DB_NAME = 'transit-lines';
const STORE = 'cityPacks';
export const PACK_FORMAT_VERSION = 8; // v8: measured traffic counts (AADT)

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => {
      // never hold a delete/upgrade hostage: close when another context asks
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('database blocked'));
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

/**
 * Tiny companion record holding just the format version of a stored pack, so
 * "is this city cached?" costs a few bytes instead of deserialising tens of
 * megabytes.
 */
const metaKey = (id: string): string => `${id}::meta`;

async function writeMeta(id: string): Promise<void> {
  try {
    const db = await open(DB_NAME);
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ formatVersion: PACK_FORMAT_VERSION }, metaKey(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } finally {
      db.close();
    }
  } catch {
    // best effort: without it we just take the slow path again next time
  }
}

export async function idbGetPack<T>(id: string): Promise<T | null> {
  try {
    await ensureMigrated();
    const db = await open(DB_NAME);
    let stale = false;
    try {
      const pack = await new Promise<T | null>((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => {
          const v = req.result;
          if (v && v.formatVersion === PACK_FORMAT_VERSION) {
            resolve(v.pack as T);
            return;
          }
          // a pack left behind by an older build is dead weight — often tens
          // of megabytes of it, which is what pushes storage over quota and
          // starts breaking saves after an update
          // (a pack from a *newer* build stays: that build can still use it)
          stale = !!v && !(v.formatVersion > PACK_FORMAT_VERSION);
          resolve(null);
        };
        req.onerror = () => resolve(null);
      });
      return pack;
    } finally {
      db.close();
      if (stale) void idbDeletePack(id);
    }
  } catch {
    return null;
  }
}

/** cheap "is this city downloaded, in a format we can still use?" check */
export async function idbHasPack(id: string): Promise<boolean> {
  try {
    await ensureMigrated();
    const db = await open(DB_NAME);
    try {
      const meta = await new Promise<{ formatVersion?: number } | null>((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(metaKey(id));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      });
      if (meta) return meta.formatVersion === PACK_FORMAT_VERSION;
    } finally {
      db.close();
    }
    // written before meta records existed: fall back to the full read (which
    // also clears it out if it turns out to be stale), then leave a meta
    // record behind so the next check stays cheap
    const ok = (await idbGetPack(id)) !== null;
    if (ok) await writeMeta(id);
    return ok;
  } catch {
    return false;
  }
}

export async function idbPutPack(id: string, pack: unknown): Promise<void> {
  try {
    await ensureMigrated();
    const db = await open(DB_NAME);
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.put({ formatVersion: PACK_FORMAT_VERSION, pack }, id);
        store.put({ formatVersion: PACK_FORMAT_VERSION }, metaKey(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } finally {
      db.close();
    }
  } catch {
    // cache is best-effort
  }
}

export async function idbDeletePack(id: string): Promise<void> {
  try {
    await ensureMigrated();
    const db = await open(DB_NAME);
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.delete(id);
        store.delete(metaKey(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
}

/**
 * Wipe every cached city pack and report whether the store is really empty
 * afterwards. Clears the store contents (which works even while other tabs
 * hold connections) rather than deleting the database, and only resolves
 * once the transaction has committed — so callers can safely reload after.
 */
export async function idbClearAllPacks(): Promise<boolean> {
  try {
    await ensureMigrated();
    const db = await open(DB_NAME);
    try {
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.clear();
        const count = store.count();
        tx.oncomplete = () => resolve(count.result === 0);
        tx.onabort = () => resolve(false);
        tx.onerror = () => resolve(false);
      });
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}
