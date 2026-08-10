import { useEffect, useState } from 'react';
import { useGame } from '../game/store';
import { canAutoReload, reloadForUpdate, watchForUpdate } from '../game/update';

/**
 * Shown when a newer build has been deployed while this tab was open. On the
 * menu there is nothing to interrupt, so the update is taken automatically;
 * mid-game the player decides when — and the game is saved either way before
 * the reload.
 */
export function UpdateBanner() {
  const phase = useGame((s) => s.phase);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => watchForUpdate(() => setReady(true)), []);

  const apply = (auto = false): void => {
    useGame.getState().saveGame();
    reloadForUpdate(auto);
  };

  // idle on the menu: swap builds now rather than let the player start a game
  // on a bundle the server has already replaced
  useEffect(() => {
    if (!ready || phase !== 'menu' || !canAutoReload()) return;
    const t = setTimeout(() => apply(true), 600);
    return () => clearTimeout(t);
  }, [ready, phase]);

  // on the menu the auto-reload above handles it, unless it has been capped —
  // then fall through to the banner and let the player press it
  if (!ready || dismissed || (phase !== 'playing' && canAutoReload())) return null;

  return (
    <div className="update-banner">
      <span>
        <b>New version available.</b> Reload when you're ready — your company is saved
        first.
      </span>
      <button className="btn primary" onClick={() => apply()}>
        Reload
      </button>
      <button className="btn" onClick={() => setDismissed(true)}>
        Not now
      </button>
    </div>
  );
}
