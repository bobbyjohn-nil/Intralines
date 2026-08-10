// Deploy awareness. A tab that stays open across a deploy keeps running the
// old bundle while the server has moved on — and the moment anything else has
// to be fetched (or the page reloads from a stale cache) the game breaks in
// confusing ways. So: stamp every build, ask the server which build is live,
// and hand the player one clean, save-first reload when they differ.

declare const __BUILD_ID__: string;

/** id of the bundle this tab is running */
export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const FIRST_CHECK_MS = 4000; // just after boot: this page may itself be stale
const POLL_MS = 15 * 60 * 1000; // background check
const MIN_GAP_MS = 60 * 1000; // never check more often than this
/** query flag that forces a fresh copy of index.html past any HTTP cache */
const FRESH_PARAM = 'fresh';
/** how many times one tab may reload itself onto a new build before it stops */
const AUTO_RELOAD_CAP = 2;
const AUTO_RELOAD_KEY = 'il-update-reloads';

function versionUrl(): string {
  return new URL('version.json', document.baseURI).href;
}

/** the build id the server is serving, or null if we can't tell */
async function liveBuild(): Promise<string | null> {
  try {
    const url = `${versionUrl()}?t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const build = (body as { build?: unknown } | null)?.build;
    return typeof build === 'string' ? build : null;
  } catch {
    // offline, file:// build, dev server — nothing to report
    return null;
  }
}

/**
 * Watch for a newer deploy. `onUpdate` fires at most once; polling stops as
 * soon as it does. Returns an unsubscribe.
 */
export function watchForUpdate(onUpdate: () => void): () => void {
  // a dev build has no deployed counterpart to compare against
  if (BUILD_ID.startsWith('dev')) return () => {};

  let stopped = false;
  let lastCheck = 0;

  const check = async (): Promise<void> => {
    if (stopped) return;
    lastCheck = Date.now();
    const live = await liveBuild();
    if (stopped || live === null || live === BUILD_ID) return;
    stop();
    onUpdate();
  };

  const onVisible = (): void => {
    // coming back to the tab is the most likely moment to have missed a
    // deploy, but don't hammer the server on every alt-tab
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > MIN_GAP_MS) {
      void check();
    }
  };

  // the very first check matters most: a page served from a browser cache can
  // be several deploys behind and still boot perfectly, right up until it
  // doesn't
  const first = setTimeout(() => void check(), FIRST_CHECK_MS);
  const timer = setInterval(() => void check(), POLL_MS);
  document.addEventListener('visibilitychange', onVisible);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  }

  return stop;
}

/**
 * Guard against a reload loop. If the deployed files and version.json ever
 * disagree — mid-deploy, or a CDN edge serving a mix — an automatic reload
 * would otherwise repeat forever. After a couple of goes the player gets the
 * banner instead and stays in control.
 */
export function canAutoReload(): boolean {
  try {
    return (Number(sessionStorage.getItem(AUTO_RELOAD_KEY)) || 0) < AUTO_RELOAD_CAP;
  } catch {
    return false;
  }
}

function noteAutoReload(): void {
  try {
    const n = Number(sessionStorage.getItem(AUTO_RELOAD_KEY)) || 0;
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(n + 1));
  } catch {
    // no sessionStorage — canAutoReload() already refuses in that case
  }
}

/**
 * Reload onto the new build. The cache-busting parameter matters: without it
 * a browser holding index.html in its HTTP cache can serve the same stale
 * page straight back and the update never lands. main.tsx tidies the URL
 * again once the new bundle is running.
 */
export function reloadForUpdate(auto = false): void {
  if (auto) noteAutoReload();
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(FRESH_PARAM, String(Date.now()));
    window.location.replace(url.href);
  } catch {
    window.location.reload();
  }
}

/** drop the cache-busting parameter from the address bar after a good boot */
export function tidyUpdateUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(FRESH_PARAM)) return;
    url.searchParams.delete(FRESH_PARAM);
    window.history.replaceState(null, '', url.href);
  } catch {
    // history unavailable — a cosmetic query string is harmless
  }
}

/**
 * Install the service worker that keeps a deploy's page and its files
 * together. Without it every layer here is recovery after a broken boot; with
 * it the browser cannot assemble a mismatched app in the first place.
 *
 * The reload on takeover is the important detail: when a worker for a NEW
 * build claims a page that an OLD worker was serving, the page in front of
 * the player is still the old one, and its next request would be answered
 * from the new build. One reload puts page and files back in step. A first
 * install never triggers it — there was nothing to be out of step with.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // a dev build has no generated worker to install
  if (BUILD_ID.startsWith('dev')) return;

  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  // The worker is for the *next* visit, so it waits for load rather than
  // competing with boot — but the page injects its own app script after
  // resolving version.json, which can land after load has already fired. A
  // plain listener would then never run and the worker would silently never
  // install, which is exactly how this failed the first time.
  const start = (): void => {
    void navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI).href)
      .catch(() => {
        // unsupported, blocked by policy, or private mode — the app still
        // works, it just loses the guarantee
      });
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/**
 * The escape hatch. If a worker ever ships broken, this is how a player gets
 * out: drop every worker and cache, then reload past the HTTP cache.
 */
export async function resetServiceWorker(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {
    // nothing registered
  }
  try {
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // no Cache Storage
  }
}
