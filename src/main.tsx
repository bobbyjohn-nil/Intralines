import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary, ErrorCenter } from './ui/ErrorCenter';
import { ConfirmHost } from './ui/Confirm';
import { installGlobalErrorHandlers } from './game/errors';
import { migrateLocalStorage } from './game/migrate';
import { registerServiceWorker, tidyUpdateUrl } from './game/update';
import './styles.css';

installGlobalErrorHandlers();
migrateLocalStorage();

// this bundle is running, so the stale-deploy reload guard can re-arm and the
// cache-busting parameter it may have added can come back off the address bar
try {
  sessionStorage.removeItem('il-reloaded');
} catch {
  // storage unavailable — fine
}
tidyUpdateUrl();
registerServiceWorker();

// No StrictMode: the MapLibre map + WebGL bus layer must not double-mount.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
    <ErrorCenter />
    <ConfirmHost />
  </ErrorBoundary>,
);

// the CSS sibling rule hides the boot splash once #root has content; remove
// it outright as well (after the first real render) so no stacking-context
// quirk can leave it around
const clearSplash = (): void => {
  const el = document.getElementById('boot-splash');
  if (!el) return;
  if (document.getElementById('root')?.childElementCount) el.remove();
  else requestAnimationFrame(clearSplash);
};
requestAnimationFrame(clearSplash);
