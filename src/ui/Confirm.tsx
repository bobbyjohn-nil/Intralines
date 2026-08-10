import { useEffect, useState } from 'react';

// Custom in-game confirmation dialog — replaces window.confirm(), which
// looks like a browser bug next to the game's UI. Imperative API so call
// sites stay one-liners: `if (await askConfirm({...})) { ... }`.

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** red confirm button for destructive actions */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let setPendingRef: ((p: Pending | null) => void) | null = null;
let queue: Pending[] = [];

export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const p = { ...opts, resolve };
    if (setPendingRef) setPendingRef(p);
    else queue.push(p);
  });
}

/** mounted once at the root; renders whatever askConfirm() is waiting on */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    setPendingRef = setPending;
    if (queue.length) {
      setPending(queue[0]);
      queue = queue.slice(1);
    }
    return () => {
      setPendingRef = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation(); // don't also cancel drafts/tools behind it
        pending.resolve(false);
        setPending(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        pending.resolve(true);
        setPending(null);
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [pending]);

  if (!pending) return null;
  const done = (ok: boolean) => {
    pending.resolve(ok);
    setPending(null);
  };

  return (
    <div className="confirm-overlay" onClick={() => done(false)}>
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <h3>{pending.title ?? 'Are you sure?'}</h3>
        <p>{pending.message}</p>
        <div className="confirm-actions">
          <button className="btn" onClick={() => done(false)} autoFocus>
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={`btn ${pending.danger ? 'danger' : 'primary'}`}
            onClick={() => done(true)}
          >
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
