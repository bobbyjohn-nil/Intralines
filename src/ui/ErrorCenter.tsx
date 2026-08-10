import { Component, useEffect, useState, type ReactNode } from 'react';
import {
  clearErrorLog,
  errorLogText,
  onErrors,
  reportError,
  type GameError,
} from '../game/errors';
import { idbClearAllPacks } from '../game/data/idb';

const TOAST_MS = 9000;

async function clearCacheAndReload(): Promise<void> {
  await idbClearAllPacks();
  location.reload();
}

function copyLog(): void {
  const text = errorLogText();
  navigator.clipboard?.writeText(text).catch(() => {
    // clipboard blocked — the details are still on screen to select
  });
}

/**
 * Error toasts + the ⚠ badge + the error log panel. Mounted once, works on
 * the menu and in-game alike.
 */
export function ErrorCenter() {
  const [log, setLog] = useState<GameError[]>([]);
  const [open, setOpen] = useState(false);
  // ids currently shown as toasts; each hides itself after TOAST_MS
  const [toasts, setToasts] = useState<number[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [boom, setBoom] = useState<string | null>(null);

  // support/testing hook: crash React on purpose to exercise the boundary
  useEffect(() => {
    (window as unknown as { __ilCrash?: (m?: string) => void }).__ilCrash = (
      m?: string,
    ) => setBoom(m ?? 'manual crash test');
  }, []);
  if (boom) throw new Error(boom);

  useEffect(
    () =>
      onErrors((next) => {
        setLog((prev) => {
          const fresh = next.filter(
            (e) => !prev.some((p) => p.id === e.id && p.count === e.count),
          );
          if (fresh.length) {
            setToasts((t) => [
              ...fresh.map((e) => e.id).filter((id) => !t.includes(id)),
              ...t,
            ].slice(0, 3));
            for (const e of fresh) {
              setTimeout(
                () => setToasts((t) => t.filter((id) => id !== e.id)),
                TOAST_MS,
              );
            }
          }
          return next;
        });
      }),
    [],
  );

  const toastErrors = toasts
    .map((id) => log.find((e) => e.id === id))
    .filter((e): e is GameError => !!e);

  return (
    <>
      {toastErrors.length > 0 && (
        <div className="error-toasts">
          {toastErrors.map((e) => (
            <div key={e.id} className="error-toast">
              <div className="et-head">
                <span className="et-icon">⚠</span>
                <span className="et-text">
                  {e.friendly}
                  {e.count > 1 ? ` (×${e.count})` : ''}
                </span>
                <button
                  className="et-x"
                  title="Dismiss"
                  onClick={() => setToasts((t) => t.filter((id) => id !== e.id))}
                >
                  ×
                </button>
              </div>
              <button
                className="et-details"
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              >
                {expanded === e.id ? 'Hide details' : 'Details'}
              </button>
              {expanded === e.id && <pre className="et-pre">{e.message}</pre>}
            </div>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <button
          className="error-badge"
          title="Error log"
          onClick={() => setOpen((o) => !o)}
        >
          ⚠ {log.length}
        </button>
      )}

      {open && (
        <div className="error-log">
          <div className="el-head">
            <b>Error log</b>
            <div className="el-actions">
              <button onClick={copyLog}>Copy all</button>
              <button onClick={() => clearCacheAndReload()}>
                Clear map cache &amp; reload
              </button>
              <button
                onClick={() => {
                  clearErrorLog();
                  setOpen(false);
                }}
              >
                Clear log
              </button>
              <button onClick={() => setOpen(false)}>×</button>
            </div>
          </div>
          <p className="el-hint">
            Errors the game caught this session. Saves are unaffected. If
            something looks broken, copy this log before reloading.
          </p>
          {log.map((e) => (
            <div key={e.id} className="el-row">
              <div className="el-meta">
                {new Date(e.at).toLocaleTimeString()} · {e.source}
                {e.count > 1 ? ` · ×${e.count}` : ''}
              </div>
              <div className="el-friendly">{e.friendly}</div>
              <pre className="et-pre">{e.message}</pre>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Last line of defense: a React render crash swaps the whole app for a
 * readable recovery screen instead of a white page.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportError('game', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="fatal-overlay">
        <div className="fatal-card">
          <h2>The game hit a wall</h2>
          <p>
            Something crashed the interface. Your saved game is safe — it
            autosaves as you play. Reloading almost always fixes this; if it
            happens again, clear the map cache too.
          </p>
          <pre className="et-pre">
            {error.message}
            {error.stack ? `\n\n${error.stack.slice(0, 1200)}` : ''}
          </pre>
          <div className="fatal-actions">
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="btn" onClick={() => clearCacheAndReload()}>
              Clear map cache &amp; reload
            </button>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(`${error.message}\n${error.stack ?? ''}`)
                  .catch(() => {});
              }}
            >
              Copy error
            </button>
          </div>
        </div>
      </div>
    );
  }
}
