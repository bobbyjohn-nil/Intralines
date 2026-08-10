import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Identifies this build. The commit sha in CI, a timestamp locally. It is
// compiled into the bundle (__BUILD_ID__) *and* written to version.json next
// to index.html, so a running tab can tell when a newer build was deployed
// and offer a clean reload instead of half-running on stale files.
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 10) ?? `dev-${Date.now()}`;

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    {
      name: 'intralines-build-stamp',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: `${JSON.stringify({ build: BUILD_ID })}\n`,
        });
      },
    },
  ],
  build: {
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
