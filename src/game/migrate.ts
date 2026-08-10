// Storage migrations. Two jobs: the one-time rename of the old "Transit
// Lines" keys, and reading saves written by *other versions of the game* —
// which is what an update mostly is, from a save file's point of view.

import { SAVE_KEY_PREFIX, SAVE_VERSION } from './constants';
import type { SaveGame } from './types';

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

// ---------------------------------------------------------------------------
// reading a save written by a different build

export type SaveRead =
  | { ok: true; save: SaveGame }
  /** written by a build newer than this one — reload before playing */
  | { ok: false; reason: 'newer' }
  /** not parseable, or not a save for this city */
  | { ok: false; reason: 'unreadable' };

/**
 * Read a stored save for `cityId`.
 *
 * Older saves are accepted: every field added since is optional and gets a
 * default when the game loads it, so an update must never turn a company into
 * a fresh start. Saves from a *newer* build are refused rather than
 * misread — that means this tab is the stale one.
 */
export function readSave(cityId: string, raw: string): SaveRead {
  let sv: SaveGame;
  try {
    sv = JSON.parse(raw) as SaveGame;
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!sv || typeof sv !== 'object' || sv.cityId !== cityId) {
    return { ok: false, reason: 'unreadable' };
  }
  if (typeof sv.version !== 'number' || !Array.isArray(sv.stops) || !Array.isArray(sv.lines)) {
    return { ok: false, reason: 'unreadable' };
  }
  if (sv.version > SAVE_VERSION) return { ok: false, reason: 'newer' };
  return { ok: true, save: sv };
}

/**
 * Park a save this build can't read somewhere the autosave won't reach, so a
 * bad update costs a player nothing worse than a reload. Only the first such
 * copy is kept: a later fresh-start autosave must not overwrite it.
 */
export function backupUnreadableSave(cityId: string, raw: string): void {
  try {
    const key = `${SAVE_KEY_PREFIX}${cityId}-backup`;
    if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
  } catch {
    // out of quota or no storage — nothing more we can do
  }
}
