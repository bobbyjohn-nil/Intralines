import { useEffect, useState } from 'react';
import { BusSide } from './icons';

const SEEN_KEY = 'il-wiped';

/**
 * The hand-off from the boot screen to the menu: a bus drives across and takes
 * the loading screen with it, so the menu arrives rather than snapping into
 * place. Runs once per tab — after that it would just be in the way — and
 * sits out entirely for anyone who asked for less motion.
 */
export function BusWipe() {
  const [state, setState] = useState<'idle' | 'run' | 'done'>('idle');

  useEffect(() => {
    let seen = true;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === '1';
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      seen = false; // no storage: play it, it is only one animation
    }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (seen || still) {
      setState('done');
      return;
    }
    setState('run');
    const t = setTimeout(() => setState('done'), 1150);
    return () => clearTimeout(t);
  }, []);

  if (state !== 'run') return null;
  return (
    <div className="bus-wipe" aria-hidden="true">
      {/* the bus rides on the sheet's leading edge, so it tows it away */}
      <div className="bus-wipe-sheet">
        <div className="bus-wipe-bus">
          <BusSide length={1} size={92} />
        </div>
      </div>
    </div>
  );
}
