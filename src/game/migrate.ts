// One-time migration of browser storage from the old "Transit Lines" keys to
// the Intralines names. Copies, then removes the old keys, so nobody loses a
// save or re-downloads city data because of the rename.

const OLD_SAVE_PREFIX = 'transit-lines-save-';
const NEW_SAVE_PREFIX = 'intralines-save-';
const OLD_BASEMAP_KEY = 'tl-basemap';
const NEW_BASEMAP_KEY = 'intralines-basemap';

export function migrateLocalStorage(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(OLD_SAVE_PREFIX)) {
        const nk = NEW_SAVE_PREFIX + k.slice(OLD_SAVE_PREFIX.length);
        const v = localStorage.getItem(k);
        if (v !== null && localStorage.getItem(nk) === null) {
          localStorage.setItem(nk, v);
        }
        localStorage.removeItem(k);
      }
    }
    const oldPref = localStorage.getItem(OLD_BASEMAP_KEY);
    if (oldPref !== null) {
      if (localStorage.getItem(NEW_BASEMAP_KEY) === null) {
        localStorage.setItem(NEW_BASEMAP_KEY, oldPref);
      }
      localStorage.removeItem(OLD_BASEMAP_KEY);
    }
  } catch {
    // storage unavailable (private mode) — nothing to migrate
  }
}
