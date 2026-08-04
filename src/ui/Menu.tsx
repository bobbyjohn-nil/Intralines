import { useEffect, useRef, useState } from 'react';
import { CITIES } from '../game/data/cities';
import { loadCity } from '../game/data/loadCity';
import { idbDeletePack, idbGetPack } from '../game/data/idb';
import { SAVE_KEY_PREFIX } from '../game/constants';
import { useGame } from '../game/store';
import type { CityMeta, SaveGame } from '../game/types';
import { BusSide, IconUpload } from './icons';
import { CHANGELOG } from './changelog';

type Tab = 'play' | 'saves' | 'settings' | 'log';

interface SaveRow {
  meta: CityMeta;
  raw: string;
  sv: SaveGame;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function gameClock(clockMin: number): string {
  const week = Math.floor(clockMin / 10080) + 1;
  const day = DAY_NAMES[Math.floor((clockMin % 10080) / 1440) % 7];
  const hh = String(Math.floor((clockMin % 1440) / 60)).padStart(2, '0');
  const mm = String(Math.floor(clockMin % 60)).padStart(2, '0');
  return `Week ${week}, ${day} ${hh}:${mm}`;
}

function money(n: number): string {
  const neg = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${neg}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${neg}$${Math.floor(a / 1000)}k`;
  return `${neg}$${Math.floor(a)}`;
}

function readSaves(): SaveRow[] {
  const rows: SaveRow[] = [];
  for (const meta of CITIES) {
    const raw = localStorage.getItem(SAVE_KEY_PREFIX + meta.id);
    if (!raw) continue;
    try {
      rows.push({ meta, raw, sv: JSON.parse(raw) as SaveGame });
    } catch {
      // unreadable save — skip it rather than crash the menu
    }
  }
  rows.sort((a, b) => (b.sv.savedAt ?? 0) - (a.sv.savedAt ?? 0));
  return rows;
}

export function Menu() {
  const openCity = useGame((s) => s.openCity);
  const setLoading = useGame((s) => s.setLoading);
  // error lives in the store: the menu unmounts during loading, so local
  // state would vanish before anyone could read it
  const error = useGame((s) => s.menuError);
  const setError = useGame((s) => s.setMenuError);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Tab>('play');
  const [saves, setSaves] = useState<SaveRow[]>(() => readSaves());

  useEffect(() => {
    (async () => {
      const flags: Record<string, boolean> = {};
      for (const c of CITIES) {
        if (c.kind === 'real') flags[c.id] = (await idbGetPack(c.id)) !== null;
      }
      setCached(flags);
    })();
  }, []);

  async function start(meta: CityMeta): Promise<void> {
    setError(null);
    try {
      const pack = await loadCity(meta, (msg, detail) => setLoading(msg, detail));
      setLoading('');
      openCity(pack);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('city load failed', e);
      setLoading('');
      setError(
        `${meta.name} failed to load — ${(e as Error).message}. ` +
          `Check your internet connection and try again; the demo city always works.`,
      );
    }
  }

  return (
    <div className="menu">
      <div className="menu-inner">
        <h1 className="logo-row">
          <span className="logo-mark"><BusSide length={1} size={54} /></span>
          Intralines Bus Simulator
          <span className="ver-chip">v{CHANGELOG[0].version}</span>
        </h1>
        <p className="tagline">
          Build a bus company on a real city. Real streets, real census commuters — draw
          smart lines, run a tight depot, watch your buses roll.
        </p>

        <div className="menu-tabs" role="tablist">
          {(
            [
              ['play', 'Play'],
              ['saves', 'Saves'],
              ['settings', 'Settings'],
              ['log', 'Changelog'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'on' : ''}
              onClick={() => {
                setTab(id);
                if (id === 'saves') setSaves(readSaves());
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="menu-error">{error}</p>}

        {tab === 'play' && <PlayTab cached={cached} start={start} />}
        {tab === 'saves' && (
          <SavesTab saves={saves} refresh={() => setSaves(readSaves())} start={start} />
        )}
        {tab === 'settings' && (
          <SettingsTab
            cached={cached}
            setCached={setCached}
            refreshSaves={() => setSaves(readSaves())}
          />
        )}
        {tab === 'log' && <LogTab />}

        <p className="menu-foot">
          Real-city mode uses live data from the US Census Bureau (ACS population, LEHD LODES
          workplaces, TIGERweb boundaries) and OpenStreetMap. Map tiles © OpenFreeMap /
          OpenMapTiles / OpenStreetMap contributors.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlayTab({
  cached,
  start,
}: {
  cached: Record<string, boolean>;
  start: (m: CityMeta) => Promise<void>;
}) {
  return (
    <div className="city-grid">
      {CITIES.map((c) => {
        const hasSave =
          typeof localStorage !== 'undefined' &&
          localStorage.getItem(SAVE_KEY_PREFIX + c.id) !== null;
        return (
          <div key={c.id} className={`city-card ${c.kind}`}>
            <div className="city-name">
              {c.name}
              {hasSave && <span className="badge">saved game</span>}
              {c.kind === 'real' && cached[c.id] && (
                <span className="badge alt">data cached</span>
              )}
            </div>
            <div className="city-region">{c.region}</div>
            <div className="city-note">
              {c.kind === 'demo'
                ? 'Bundled sample city. Start here to learn the ropes.'
                : cached[c.id]
                  ? 'Census + street data ready to go.'
                  : 'Real census + street data. Loads instantly when bundled with the game; otherwise a one-time browser download (≈10–40 MB).'}
            </div>
            <div className="btn-row">
              <button className="btn primary" onClick={() => start(c)}>
                {hasSave ? 'Continue' : 'Play'}
              </button>
              {hasSave && (
                <button
                  className="btn"
                  onClick={() => {
                    if (confirm(`Start over in ${c.name}? Your save will be deleted.`)) {
                      localStorage.removeItem(SAVE_KEY_PREFIX + c.id);
                      start(c);
                    }
                  }}
                >
                  New game
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SavesTab({
  saves,
  refresh,
  start,
}: {
  saves: SaveRow[];
  refresh: () => void;
  start: (m: CityMeta) => Promise<void>;
}) {
  const importSave = useGame((s) => s.importSave);
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="save-list">
      {saves.length === 0 && (
        <p className="hint">
          No saved games yet. The game autosaves every couple of in-game hours while you
          play — your companies will show up here.
        </p>
      )}
      {saves.map(({ meta, raw, sv }) => (
        <div key={meta.id} className="save-row">
          <div className="save-main">
            <b>{meta.name}</b>
            <small>
              {gameClock(sv.clockMin)} · {money(sv.cash)} · {sv.lines.length}{' '}
              {sv.lines.length === 1 ? 'line' : 'lines'} ·{' '}
              {sv.fleet.reduce((s, f) => s + f.count, 0)} buses
            </small>
            <small className="dim">
              {sv.savedAt ? `Saved ${new Date(sv.savedAt).toLocaleString()}` : 'Saved earlier'}
            </small>
          </div>
          <div className="save-actions">
            <button className="btn primary" onClick={() => start(meta)}>
              Continue
            </button>
            <button
              className="btn"
              title="Download this save as a file"
              onClick={() => {
                const blob = new Blob([raw], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `intralines-${meta.id}-save.json`;
                a.click();
              }}
            >
              Export
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (confirm(`Delete your ${meta.name} save? This cannot be undone.`)) {
                  localStorage.removeItem(SAVE_KEY_PREFIX + meta.id);
                  refresh();
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      <div className="btn-row">
        <button className="btn with-icon" onClick={() => fileRef.current?.click()}>
          <IconUpload size={15} /> Import save file
        </button>
        {note && <span className="hint">{note}</span>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const ok = importSave(await f.text());
          setNote(ok ? 'Save imported.' : 'That file is not a valid save.');
          refresh();
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SettingsTab({
  cached,
  setCached,
  refreshSaves,
}: {
  cached: Record<string, boolean>;
  setCached: (f: (p: Record<string, boolean>) => Record<string, boolean>) => void;
  refreshSaves: () => void;
}) {
  const basemapPref = useGame((s) => s.basemapPref);
  const toggleBasemap = useGame((s) => s.toggleBasemap);
  const realCities = CITIES.filter((c) => c.kind === 'real');

  return (
    <div className="settings">
      <div className="settings-group">
        <h3>Map</h3>
        <div className="settings-row">
          <div>
            <b>Basemap</b>
            <small>
              Auto uses pretty online map tiles when reachable; Offline never phones home
              and always uses the built-in map.
            </small>
          </div>
          <div className="seg">
            <button
              className={basemapPref === 'auto' ? 'on' : ''}
              onClick={() => basemapPref !== 'auto' && toggleBasemap()}
            >
              Auto
            </button>
            <button
              className={basemapPref === 'offline' ? 'on' : ''}
              onClick={() => basemapPref !== 'offline' && toggleBasemap()}
            >
              Offline
            </button>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h3>Downloaded city data</h3>
        {realCities.map((c) => (
          <div key={c.id} className="settings-row">
            <div>
              <b>{c.name}</b>
              <small>{cached[c.id] ? 'Cached in this browser.' : 'Not downloaded yet.'}</small>
            </div>
            <button
              className="btn"
              disabled={!cached[c.id]}
              onClick={async () => {
                await idbDeletePack(c.id);
                setCached((f) => ({ ...f, [c.id]: false }));
              }}
            >
              Clear
            </button>
          </div>
        ))}
        <p className="hint">
          Clearing forces a fresh download next time you open that city — useful after big
          game updates.
        </p>
      </div>

      <div className="settings-group danger-zone">
        <h3>Danger zone</h3>
        <div className="settings-row">
          <div>
            <b>Reset everything</b>
            <small>Deletes every saved game and all cached city data in this browser.</small>
          </div>
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm('Delete ALL saves and cached city data? This cannot be undone.')) {
                return;
              }
              for (const c of CITIES) {
                localStorage.removeItem(SAVE_KEY_PREFIX + c.id);
                if (c.kind === 'real') await idbDeletePack(c.id);
              }
              setCached(() => ({}));
              refreshSaves();
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LogTab() {
  return (
    <div className="log-list">
      {CHANGELOG.map((e) => (
        <div key={e.version} className="log-entry">
          <div className="log-head">
            <b>
              v{e.version} — {e.title}
            </b>
            <span className="dim">{e.date}</span>
          </div>
          <ul>
            {e.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
