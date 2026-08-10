// Keep previous deploys' hashed assets alive so a cached index.html never
// points at files that no longer exist. GitHub Pages caches HTML for ~10
// minutes and long-running tabs hold it far longer — every deploy used to
// open a window where the stale page referenced deleted index-<hash>.js
// files and the game white-screened ("bugs out every time it updates").
//
// Run after `vite build`, before upload. Best-effort: any failure just
// means this deploy ships without the archive (same as before this script).

import { readdirSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';

const DIST = resolve(process.cwd(), 'dist');
const LIVE = process.env.LIVE_URL || 'https://bobbyjohn-nil.github.io/Intralines';
// same id convention as vite.config.ts, so manifest rows match version.json
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 10) ?? process.env.BUILD_ID ?? 'dev';
const KEEP_BUILDS = 8;

if (!existsSync(DIST)) {
  console.error('retain-assets: dist/ missing — run vite build first');
  process.exit(1);
}

const currentFiles = readdirSync(join(DIST, 'assets')).map((f) => `assets/${f}`);
let prior = [];
try {
  const res = await fetch(`${LIVE}/asset-manifest.json`, { cache: 'no-store' });
  if (res.ok) {
    const m = await res.json();
    if (Array.isArray(m.builds)) prior = m.builds;
  }
} catch (e) {
  console.warn('retain-assets: no previous manifest reachable —', e.message);
}

// newest first, drop any stale record of this same build id, cap the tail
prior = prior
  .filter((b) => b && b.id !== BUILD_ID && Array.isArray(b.files))
  .slice(0, KEEP_BUILDS - 1);

let fetched = 0;
let missed = 0;
const have = new Set(currentFiles);
mkdirSync(join(DIST, 'assets'), { recursive: true });
for (const b of prior) {
  for (const f of b.files) {
    if (have.has(f) || !/^assets\/[\w.-]+$/.test(f)) continue;
    have.add(f); // only try each file once even if listed by two builds
    try {
      const res = await fetch(`${LIVE}/${f}`);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(join(DIST, f)));
      fetched++;
    } catch {
      missed++; // gone from the live site — drop it from the manifest too
      b.files = b.files.filter((x) => x !== f);
    }
  }
}

const manifest = {
  builds: [
    { id: BUILD_ID, at: new Date().toISOString(), files: currentFiles },
    ...prior,
  ],
};
writeFileSync(join(DIST, 'asset-manifest.json'), JSON.stringify(manifest, null, 1));
console.log(
  `retain-assets: kept ${prior.length} prior build(s), re-fetched ${fetched} file(s)` +
    (missed ? `, ${missed} no longer on the live site` : ''),
);
