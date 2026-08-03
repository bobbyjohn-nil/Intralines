import { useEffect, useState } from 'react';
import { CITIES } from '../game/data/cities';
import { loadCity } from '../game/data/loadCity';
import { idbDeletePack, idbGetPack } from '../game/data/idb';
import { SAVE_KEY_PREFIX } from '../game/constants';
import { useGame } from '../game/store';
import type { CityMeta } from '../game/types';

export function Menu() {
  const openCity = useGame((s) => s.openCity);
  const setLoading = useGame((s) => s.setLoading);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState<Record<string, boolean>>({});

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
      setLoading('');
      setError(
        `${meta.name}: ${(e as Error).message} — live census/OpenStreetMap downloads ` +
          `need internet access. The demo city always works, or bake data with "npm run bake".`,
      );
    }
  }

  return (
    <div className="menu">
      <div className="menu-inner">
        <h1>
          🚌 Transit Lines
        </h1>
        <p className="tagline">
          Build a bus company on a real city. Real streets, real census commuters — draw
          smart lines, run a tight depot, watch your buses roll.
        </p>
        {error && <p className="menu-error">{error}</p>}
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
                      : 'First launch downloads census + street data in your browser (≈10–40 MB, one time).'}
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
                  {c.kind === 'real' && cached[c.id] && (
                    <button
                      className="btn ghost"
                      title="Delete the cached city data"
                      onClick={async () => {
                        await idbDeletePack(c.id);
                        setCached((f) => ({ ...f, [c.id]: false }));
                      }}
                    >
                      ✕ cache
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="menu-foot">
          Real-city mode uses live data from the US Census Bureau (ACS population, LEHD LODES
          workplaces, TIGERweb boundaries) and OpenStreetMap. Map tiles © OpenFreeMap /
          OpenMapTiles / OpenStreetMap contributors.
        </p>
      </div>
    </div>
  );
}
