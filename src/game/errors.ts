// Central error bus: everything that goes wrong funnels through here so the
// player always gets a readable message (and a log) instead of a silent
// breakage or a blank screen. UI subscribes via onErrors().

export type ErrorSource = 'game' | 'simulation' | 'map' | 'save' | 'load';

export interface GameError {
  id: number;
  at: number; // Date.now()
  source: ErrorSource;
  /** short player-facing explanation */
  friendly: string;
  /** raw technical message */
  message: string;
  detail?: string; // stack trace etc.
  count: number; // dedupe counter for repeats
}

const MAX_LOG = 25;
let seq = 0;
let log: GameError[] = [];
const listeners = new Set<(log: GameError[]) => void>();

// noise that reaches window.onerror in the wild but means nothing is broken
const IGNORE = [
  /ResizeObserver loop/i,
  /Script error\.?$/i, // opaque cross-origin errors carry no information
  /AbortError/i,
];

const SOURCE_LABEL: Record<ErrorSource, string> = {
  game: 'the game',
  simulation: 'the passenger simulation',
  map: 'the map',
  save: 'saving',
  load: 'city loading',
};

/** best-effort translation of a technical message into player language */
export function friendlyText(source: ErrorSource, message: string): string {
  if (/quota|storage full|QuotaExceeded/i.test(message)) {
    return 'Browser storage is full — saves and map data may not stick. Clear old city data in Settings to free space.';
  }
  if (/failed to fetch|networkerror|load failed|ERR_|fetch/i.test(message)) {
    return 'A download failed — check your internet connection and try again.';
  }
  if (/webgl|context lost|CONTEXT_LOST/i.test(message)) {
    return 'Graphics hiccup — your browser dropped the 3D view. A reload usually brings it back.';
  }
  if (/out of memory|allocation/i.test(message)) {
    return 'The browser ran out of memory. Closing other tabs and reloading should help.';
  }
  return `Something went wrong in ${SOURCE_LABEL[source]}. The game keeps running, but if things look off, reload.`;
}

function emit(): void {
  const snapshot = [...log];
  for (const fn of listeners) fn(snapshot);
}

export function reportError(
  source: ErrorSource,
  err: unknown,
  friendly?: string,
): void {
  const e = err instanceof Error ? err : null;
  const message = String(e?.message ?? err ?? 'Unknown error').slice(0, 500);
  if (IGNORE.some((rx) => rx.test(message))) return;
  const detail = e?.stack?.slice(0, 2000);
  const dup = log.find((x) => x.message === message && x.source === source);
  if (dup) {
    dup.count += 1;
    dup.at = Date.now();
    log = [dup, ...log.filter((x) => x !== dup)];
  } else {
    log = [
      {
        id: ++seq,
        at: Date.now(),
        source,
        friendly: friendly ?? friendlyText(source, message),
        message,
        detail,
        count: 1,
      },
      ...log,
    ].slice(0, MAX_LOG);
  }
  emit();
}

export function onErrors(fn: (log: GameError[]) => void): () => void {
  listeners.add(fn);
  fn([...log]);
  return () => listeners.delete(fn);
}

export function getErrorLog(): GameError[] {
  return [...log];
}

export function clearErrorLog(): void {
  log = [];
  emit();
}

/** one clipboard-ready report of everything in the log */
export function errorLogText(): string {
  return log
    .map(
      (e) =>
        `[${new Date(e.at).toISOString()}] (${e.source}${e.count > 1 ? ` ×${e.count}` : ''}) ` +
        `${e.message}${e.detail ? `\n${e.detail}` : ''}`,
    )
    .join('\n\n');
}

let installed = false;

/** catch uncaught exceptions + unhandled promise rejections page-wide */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (ev) => {
    // resource-load failures (script/img tags) have no ev.error and are
    // handled by the boot guard in index.html — skip them here
    if (!ev.error && !ev.message) return;
    reportError('game', ev.error ?? ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    reportError('game', ev.reason);
  });
}
