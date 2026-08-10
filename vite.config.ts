import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Identifies this build. The commit sha in CI, a timestamp locally. It is
// compiled into the bundle (__BUILD_ID__) *and* written to version.json next
// to index.html, so a running tab can tell when a newer build was deployed
// and offer a clean reload instead of half-running on stale files.
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 10) ?? `dev-${Date.now()}`;

/**
 * Makes the served page immune to being cached.
 *
 * Vite normally bakes the hashed bundle names straight into index.html, which
 * means a browser holding an old copy of that page (GitHub Pages serves it
 * with a ten-minute max-age, and reloads can be answered from cache well past
 * that) asks for files the deploy has already deleted, and the game breaks.
 *
 * So the built page ships no version-specific references at all. A tiny inline
 * loader reads the *current* file names from version.json — fetched
 * no-store, so it can never come from a cache — and injects them. A page from
 * any era boots the build that is live right now. If version.json can't be
 * reached (offline, or the Electron shell), it falls back to the names baked
 * in at build time, which is exactly what the page used to do.
 */
function versionedBoot() {
  let assets = { js: '', css: [] as string[] };

  return {
    name: 'intralines-versioned-boot',
    apply: 'build' as const,
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string) {
        const js = /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/.exec(html);
        const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
        if (!js) return html; // nothing to swap — leave the page alone
        assets = { js: js[1], css: css.map((m) => m[1]) };

        const stripped = html
          .replace(js[0], '')
          .replace(/<link rel="stylesheet"[^>]*>/g, '');
        const loader = `
    <script>
      // Resolve this build's files at run time — see vite.config.ts.
      (function () {
        var FALLBACK = ${JSON.stringify(assets)};
        var done = false;
        function load(a) {
          if (done) return;
          done = true;
          var css = (a && a.css) || [];
          for (var i = 0; i < css.length; i++) {
            var l = document.createElement('link');
            l.rel = 'stylesheet';
            l.href = new URL(css[i], document.baseURI).href;
            document.head.appendChild(l);
          }
          var s = document.createElement('script');
          s.type = 'module';
          s.src = new URL((a && a.js) || FALLBACK.js, document.baseURI).href;
          document.head.appendChild(s);
        }
        // Never let a slow or hanging network hold the game hostage. The
        // baked-in names are right whenever the page came from the current
        // deploy — which is the common case — and if they are not, the stale
        // asset 404s and the boot guard above reloads onto a fresh page.
        var t = setTimeout(function () { load(FALLBACK); }, 2000);
        var fell = function () { clearTimeout(t); load(FALLBACK); };
        try {
          fetch(new URL('version.json', document.baseURI).href + '?t=' + Date.now(), {
            cache: 'no-store',
          })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (v) {
              clearTimeout(t);
              load(v && v.assets && v.assets.js ? v.assets : FALLBACK);
            })
            .catch(fell);
        } catch (e) {
          fell();
        }
      })();
    </script>
  </head>`;
        return stripped.replace('</head>', loader);
      },
    },
    writeBundle(options: { dir?: string }) {
      // written here rather than via emitFile so it always reflects the names
      // the html transform actually settled on
      writeFileSync(
        join(options.dir ?? 'dist', 'version.json'),
        `${JSON.stringify({ build: BUILD_ID, assets })}\n`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), versionedBoot()],
  build: {
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
